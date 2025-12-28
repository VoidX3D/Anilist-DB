
import sharp from 'sharp';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { generateBatchQuery } from './query';
import { dbRequest } from './db';
import { Server } from 'socket.io';
import puppeteer from 'puppeteer';

const STATE_FILE = path.join(process.cwd(), 'scraper-state.json');
const RAW_DIR = path.join(process.cwd(), 'data', 'raw');
const DB_BASE_DIR = path.join(process.cwd(), 'database', 'data');
export const MAX_ID = parseInt(process.env.MAX_ID || '650000');

let isRunning = false;
let isPaused = false;

let status = {
    totalScraped: 0,
    totalVerified: 0,
    totalScanning: 0,
    processedCount: 0,
    currentId: 0,
    errors: 0,
    activeWorkers: 0,
    lastScraped: '',
    percent: '0',
    mode: 'LEGAL',
    cooldown: 0,
    networkStatus: 'IDLE',
    remainingLimit: 90,
    storageWarning: false
};

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
];

function getRandomIP() { return Array.from({ length: 4 }, () => Math.floor(Math.random() * 255)).join('.'); }

function getHeaders() {
    return {
        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
        'X-Forwarded-For': getRandomIP(),
        'Accept': 'application/json',
        'Origin': 'https://anilist.co',
        'Referer': 'https://anilist.co/'
    };
}

export const getScraperStatus = () => status;
export const pauseScraper = () => { isPaused = true; };
export const resumeScraper = () => { isPaused = false; };
export const stopScraper = () => { isRunning = false; isPaused = false; };

export function initFolders() {
    fs.ensureDirSync(RAW_DIR);
    fs.ensureDirSync(DB_BASE_DIR);
    fs.ensureDirSync(path.join(DB_BASE_DIR, 'anime'));
    fs.ensureDirSync(path.join(DB_BASE_DIR, 'manga'));
}

export async function flushAllData() {
    isRunning = false;
    try {
        if (fs.existsSync(path.join(process.cwd(), 'data'))) await fs.remove(path.join(process.cwd(), 'data'));
        if (fs.existsSync(path.join(process.cwd(), 'database'))) await fs.remove(path.join(process.cwd(), 'database'));
        if (fs.existsSync(STATE_FILE)) await fs.remove(STATE_FILE);
        initFolders();
        await dbRequest('TRUNCATE TABLE anime RESTART IDENTITY CASCADE');
        status = { ...status, totalScraped: 0, totalVerified: 0, totalScanning: 0, processedCount: 0, currentId: 0, errors: 0 };
        return true;
    } catch (e) { return false; }
}

function getFreeSpaceGB(): Promise<number> {
    return new Promise((resolve) => {
        exec("df -BG . | awk 'NR==2 {print $4}' | sed 's/G//'", (err, stdout) => {
            if (err) return resolve(999);
            resolve(parseInt(stdout.trim()) || 999);
        });
    });
}

async function fastImageProcess(url: string, destPath: string) {
    if (!url) return;
    const finalPath = destPath.replace(/\.(jpg|png|jpeg)$/, '.webp');
    if (await fs.pathExists(finalPath)) return;
    axios({ url, method: 'GET', responseType: 'arraybuffer', timeout: 5000 }).then(res => {
        sharp(res.data).webp({ quality: 30 }).resize({ width: 500 }).toFile(finalPath).catch(() => { });
    }).catch(() => { });
}

async function processMedia(media: any, io?: Server, isCache = false, filters: any = {}) {
    if (!media) return;
    const id = media.id;

    // --- TEMPORAL FILTERING ---
    const year = media.seasonYear || (media.startDate && media.startDate.year);
    if (filters.minYear && year < filters.minYear) return;
    if (filters.maxYear && year > filters.maxYear) return;

    const typeFolder = media.type?.toLowerCase() === 'manga' ? 'manga' : 'anime';
    const typeDir = path.join(DB_BASE_DIR, typeFolder);
    const safeTitle = (media.title?.romaji || media.title?.english || `ID_${id}`).replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
    const entryDir = path.join(typeDir, `${safeTitle}_${id}`);

    try {
        if (!isCache) {
            await fs.ensureDir(RAW_DIR);
            await fs.writeJson(path.join(RAW_DIR, `${id}.json`), media, { spaces: 0 });
            await fs.ensureDir(entryDir);
            await fs.writeJson(path.join(entryDir, 'info.json'), media, { spaces: 0 });
        }

        await dbRequest(`
            INSERT INTO anime (id, title_romaji, title_english, title_native, description, type, format, status, season, season_year, episodes, duration, cover_image_url, banner_image_url, genres, average_score, popularity, raw_data, last_updated)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
            ON CONFLICT (id) DO UPDATE SET 
                title_romaji = EXCLUDED.title_romaji, title_english = EXCLUDED.title_english,
                raw_data = EXCLUDED.raw_data, last_updated = NOW();
        `, [
            id, media.title?.romaji, media.title?.english, media.title?.native,
            media.description, media.type, media.format, media.status,
            media.season, media.seasonYear, media.episodes, media.duration,
            media.coverImage?.extraLarge, media.bannerImage, media.genres,
            media.averageScore, media.popularity, JSON.stringify(media)
        ]);

        // --- RELATIONS ENGINE ---
        if (media.relations?.edges) {
            for (const edge of media.relations.edges) {
                if (edge.node && edge.node.id) {
                    await dbRequest(`
                        INSERT INTO anime_relations (parent_id, related_id, relation_type)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (parent_id, related_id) DO NOTHING
                    `, [id, edge.node.id, edge.relationType]);
                }
            }
        }

        status.totalVerified++;
        if (!isCache) status.totalScraped++;

        status.lastScraped = media.title?.romaji;
        if (io) io.emit('new-entry', {
            id,
            title: media.title?.romaji,
            cover: media.coverImage?.large,
            folder: `${typeFolder}/${safeTitle}_${id}`,
            type: media.type,
            isCache,
            relations: media.relations?.edges?.length || 0
        });
        if (!isCache && media.coverImage?.extraLarge) fastImageProcess(media.coverImage.extraLarge, path.join(entryDir, 'cover.jpg'));
    } catch (e: any) {
        if (io) io.emit('terminal-log', `[DB_ERR] ${e.message}`);
    }
}

async function runWebScraper(id: number, io?: Server, filters: any = {}) {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    try {
        let mediaData: any = null;
        await page.setRequestInterception(true);
        page.on('request', req => req.continue());
        page.on('response', async res => {
            if (res.url().includes('graphql.anilist.co')) {
                try { const json = await res.json(); if (json.data?.Media) mediaData = json.data.Media; } catch (e) { }
            }
        });
        await page.goto(`https://anilist.co/anime/${id}`, { waitUntil: 'load', timeout: 30000 });
        if (mediaData) await processMedia(mediaData, io, false, filters);
    } catch (e) { } finally { await browser.close(); }
}

export async function runScraper(io?: Server, options: any = {}) {
    if (isRunning) return;
    initFolders();
    isRunning = true;
    isPaused = false;
    status.mode = options.mode || 'LEGAL';
    status.storageWarning = false;

    let currentId = (options.startId && !isNaN(options.startId)) ? options.startId : 1;
    let endId = (options.endId && !isNaN(options.endId)) ? options.endId : MAX_ID;

    // Filter definitions
    const filters = {
        minYear: options.minYear ? parseInt(options.minYear) : null,
        maxYear: options.maxYear ? parseInt(options.maxYear) : null
    };

    if (options.resume && fs.existsSync(STATE_FILE)) {
        try {
            const state = await fs.readJson(STATE_FILE);
            if (!options.startId) {
                currentId = state.currentId || 1;
                status.totalScraped = state.totalScraped || 0;
                status.totalVerified = state.totalVerified || 0;
            }
        } catch (e) { }
    }

    const nextBatch = async () => {
        if (!isRunning || currentId > endId) { isRunning = false; status.networkStatus = 'IDLE'; if (io) io.emit('update', status); return; }
        if (isPaused) { setTimeout(nextBatch, 1000); return; }

        // --- STORAGE SENTINEL ---
        if (options.storageLimitGB) {
            const free = await getFreeSpaceGB();
            if (free < options.storageLimitGB) {
                isRunning = false;
                status.networkStatus = 'IDLE';
                status.storageWarning = true;
                if (io) {
                    io.emit('update', status);
                    io.emit('terminal-log', `[CRITICAL] Storage Limit Hit! Free space: ${free}GB. Shutdown initiated.`);
                }
                return;
            }
        }

        status.networkStatus = 'WAITING';
        const batchIds: number[] = [];
        const idsToFetch: number[] = [];
        const batchSize = (status.mode === 'GHOST') ? 8 : 4;

        for (let i = 0; i < batchSize && currentId <= endId; i++) {
            const id = currentId++;
            batchIds.push(id);
            status.totalScanning++;
            if (fs.existsSync(path.join(RAW_DIR, `${id}.json`))) {
                try { await processMedia(await fs.readJson(path.join(RAW_DIR, `${id}.json`)), io, true, filters); }
                catch (e) { idsToFetch.push(id); }
            } else { idsToFetch.push(id); }
        }

        status.currentId = batchIds[0];
        status.processedCount += batchIds.length;
        status.percent = ((status.processedCount / (endId - (options.startId || 1) + 1)) * 100).toFixed(4);
        if (io) io.emit('update', status);

        if (idsToFetch.length > 0) {
            status.networkStatus = 'SENDING';
            try {
                if (status.mode === 'WEB') {
                    for (const id of idsToFetch) await runWebScraper(id, io, filters);
                } else {
                    const res = await axios({
                        url: 'https://graphql.anilist.co',
                        method: 'POST',
                        headers: getHeaders(),
                        data: { query: generateBatchQuery(idsToFetch, status.mode !== 'GHOST') },
                        timeout: 30000
                    });

                    status.remainingLimit = parseInt(res.headers['x-ratelimit-remaining'] || '30');
                    const data = res.data.data;
                    if (data) {
                        for (const key of Object.keys(data)) if (data[key]) await processMedia(data[key], io, false, filters);
                    }
                }
            } catch (error: any) {
                if (error.response?.status === 429) {
                    const wait = parseInt(error.response.headers['retry-after'] || '75');
                    currentId -= batchIds.length;
                    status.processedCount -= batchIds.length;
                    status.totalScanning -= batchIds.length;
                    status.cooldown = wait;
                    const it = setInterval(() => { status.cooldown--; if (io) io.emit('update', status); if (status.cooldown <= 0) clearInterval(it); }, 1000);
                    await new Promise(r => setTimeout(r, wait * 1000));
                } else {
                    status.errors += idsToFetch.length;
                }
            }
        }

        await fs.writeJson(STATE_FILE, { currentId, totalScraped: status.totalScraped, totalVerified: status.totalVerified });

        if (isRunning) {
            let delay = 1800;
            if (status.mode === 'BURST') delay = 900;
            if (status.mode === 'GHOST') delay = 200;
            setTimeout(nextBatch, delay + Math.random() * 200);
        }
    };

    const con = (status.mode === 'GHOST') ? 25 : (status.mode === 'BURST' ? 6 : 1);
    for (let i = 0; i < con; i++) {
        nextBatch();
        await new Promise(r => setTimeout(r, 100));
    }
}
