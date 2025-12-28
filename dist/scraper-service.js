"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopScraper = exports.pauseScraper = exports.getScraperStatus = exports.MAX_ID = void 0;
exports.initFolders = initFolders;
exports.flushAllData = flushAllData;
exports.runScraper = runScraper;
const sharp_1 = __importDefault(require("sharp"));
const axios_1 = __importDefault(require("axios"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
// @ts-ignore
const { HttpsProxyAgent } = require('https-proxy-agent');
const query_1 = require("./query");
const proxy_1 = require("./proxy");
const db_1 = require("./db");
const CONCURRENCY = 8; // Slightly lower for stability without proxies
const STATE_FILE = path_1.default.join(process.cwd(), 'scraper-state.json');
const RAW_DIR = path_1.default.join(process.cwd(), 'data', 'raw');
const DB_BASE_DIR = path_1.default.join(process.cwd(), 'database', 'data');
exports.MAX_ID = 350000;
const proxyManager = new proxy_1.ProxyManager();
let isRunning = false;
let isPaused = false;
let status = {
    totalScraped: 0,
    processedCount: 0, // Track how many IDs we've checked total
    currentId: 0,
    errors: 0,
    activeWorkers: 0,
    lastScraped: '',
    left: 0,
    percent: '0'
};
const getScraperStatus = () => status;
exports.getScraperStatus = getScraperStatus;
const pauseScraper = () => {
    isPaused = true;
    isRunning = false;
};
exports.pauseScraper = pauseScraper;
const stopScraper = () => {
    isRunning = false;
    isPaused = false;
};
exports.stopScraper = stopScraper;
function initFolders() {
    fs_extra_1.default.ensureDirSync(RAW_DIR);
    fs_extra_1.default.ensureDirSync(DB_BASE_DIR);
    fs_extra_1.default.ensureDirSync(path_1.default.join(DB_BASE_DIR, 'anime'));
    fs_extra_1.default.ensureDirSync(path_1.default.join(DB_BASE_DIR, 'manga'));
    console.log("[SYSTEM] Folder structure ready.");
}
async function flushAllData() {
    console.log("[SYSTEM] Wiping all data...");
    isRunning = false;
    isPaused = false;
    try {
        if (fs_extra_1.default.existsSync(path_1.default.join(process.cwd(), 'data')))
            fs_extra_1.default.removeSync(path_1.default.join(process.cwd(), 'data'));
        if (fs_extra_1.default.existsSync(path_1.default.join(process.cwd(), 'database')))
            fs_extra_1.default.removeSync(path_1.default.join(process.cwd(), 'database'));
        if (fs_extra_1.default.existsSync(STATE_FILE))
            fs_extra_1.default.removeSync(STATE_FILE);
        initFolders();
        await (0, db_1.dbRequest)('TRUNCATE TABLE anime RESTART IDENTITY CASCADE');
        status = {
            totalScraped: 0,
            processedCount: 0,
            currentId: 0,
            errors: 0,
            activeWorkers: 0,
            lastScraped: '',
            left: 0,
            percent: '0'
        };
        console.log("[SYSTEM] Wipe complete.");
        return true;
    }
    catch (e) {
        console.error("[ERROR] Flush failed:", e.message);
        return false;
    }
}
async function downloadAndCompressImage(url, destPath) {
    if (!url)
        return;
    const finalPath = destPath.replace(/\.(jpg|png|jpeg)$/, '.webp');
    try {
        if (await fs_extra_1.default.pathExists(finalPath))
            return;
        const response = await (0, axios_1.default)({
            url,
            method: 'GET',
            responseType: 'arraybuffer',
            timeout: 15000
        });
        await (0, sharp_1.default)(response.data)
            .webp({ quality: 80 })
            .resize({ width: 1000, withoutEnlargement: true })
            .toFile(finalPath);
    }
    catch (e) { }
}
async function scrapeId(id, io, filters) {
    if (!isRunning && !isPaused)
        return { status: 'STOPPED' };
    const proxy = proxyManager.getNextProxy();
    const axiosConfig = {
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        data: { query: query_1.ANIME_QUERY, variables: { id } },
        timeout: 20000
    };
    if (proxy)
        axiosConfig.httpsAgent = new HttpsProxyAgent(proxy);
    try {
        const response = await (0, axios_1.default)(axiosConfig);
        const data = response.data;
        if (data.errors) {
            const is404 = data.errors.some((e) => e.status === 404 || e.message?.includes('Not Found'));
            if (is404)
                return { status: 'NOT_FOUND', id };
            return { status: 'ERROR', id, error: data.errors };
        }
        const media = data.data.Media;
        if (!media)
            return { status: 'NOT_FOUND', id };
        // Filtering
        if (filters?.fromYear || filters?.toYear) {
            const y = media.startDate?.year;
            if (!y || (filters.fromYear && y < filters.fromYear) || (filters.toYear && y > filters.toYear)) {
                return { status: 'SKIPPED', id };
            }
        }
        const typeFolder = media.type?.toLowerCase() === 'manga' ? 'manga' : 'anime';
        const typeDir = path_1.default.join(DB_BASE_DIR, typeFolder);
        // Save File System
        await fs_extra_1.default.writeJson(path_1.default.join(RAW_DIR, `${id}.json`), data, { spaces: 2 });
        const safeTitle = (media.title?.romaji || media.title?.english || `ID_${id}`)
            .replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
        const entryDir = path_1.default.join(typeDir, `${safeTitle}_${id}`);
        await fs_extra_1.default.ensureDir(entryDir);
        await fs_extra_1.default.writeJson(path_1.default.join(entryDir, 'info.json'), media, { spaces: 2 });
        // Sync Database (Primary Media)
        const dbFields = [
            media.id, media.title?.romaji, media.title?.english, media.title?.native,
            media.description, media.type, media.format, media.status, media.season,
            media.seasonYear, media.episodes, media.duration, media.coverImage?.extraLarge,
            media.bannerImage, media.genres, media.averageScore, media.popularity,
            JSON.stringify(media)
        ];
        await (0, db_1.dbRequest)(`
            INSERT INTO anime (
                id, title_romaji, title_english, title_native, description, 
                type, format, status, season, season_year, episodes, duration, 
                cover_image_url, banner_image_url, genres, average_score, 
                popularity, raw_data, last_updated
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
            ON CONFLICT (id) DO UPDATE SET raw_data = EXCLUDED.raw_data, last_updated = NOW();
        `, dbFields);
        // Sync Relations
        if (media.relations?.edges) {
            for (const rel of media.relations.edges) {
                if (rel.node?.id) {
                    await (0, db_1.dbRequest)(`
                        INSERT INTO anime_relations (parent_id, related_id, relation_type)
                        VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
                    `, [media.id, rel.node.id, rel.relationType]);
                }
            }
        }
        // Parallel Image Tasks
        const imgTasks = [];
        if (media.coverImage?.extraLarge)
            imgTasks.push(downloadAndCompressImage(media.coverImage.extraLarge, path_1.default.join(entryDir, 'cover.jpg')));
        if (media.bannerImage)
            imgTasks.push(downloadAndCompressImage(media.bannerImage, path_1.default.join(entryDir, 'banner.jpg')));
        if (media.characters?.nodes) {
            const charDir = path_1.default.join(entryDir, 'characters');
            await fs_extra_1.default.ensureDir(charDir);
            media.characters.nodes.slice(0, 10).forEach((c) => {
                if (c.image?.large)
                    imgTasks.push(downloadAndCompressImage(c.image.large, path_1.default.join(charDir, `${c.id}.jpg`)));
            });
        }
        await Promise.all(imgTasks);
        status.totalScraped++;
        status.lastScraped = media.title?.romaji;
        if (io) {
            io.emit('new-entry', {
                id: media.id,
                title: media.title?.romaji,
                cover: media.coverImage?.large,
                folder: `${typeFolder}/${safeTitle}_${id}`,
                type: media.type
            });
        }
        return { status: 'SUCCESS', id };
    }
    catch (error) {
        if (error.response?.status === 429) {
            console.warn(`[RATE LIMIT] Waiting 60s for ID ${id}...`);
            await new Promise(r => setTimeout(r, 65000)); // Slightly more than 60s
            return scrapeId(id, io, filters);
        }
        status.errors++;
        return { status: 'ERROR', id, error: error.message };
    }
}
async function runScraper(io, options = {}) {
    if (isRunning)
        return;
    initFolders();
    isRunning = true;
    isPaused = false;
    let startId = options.startId || 1;
    let endId = options.endId || exports.MAX_ID;
    let currentIndex = 0;
    if (options.resume && fs_extra_1.default.existsSync(STATE_FILE)) {
        try {
            const state = await fs_extra_1.default.readJson(STATE_FILE);
            startId = state.config.startId;
            endId = state.config.endId;
            currentIndex = state.queueIndex;
            status.totalScraped = state.totalScraped;
            status.processedCount = state.queueIndex;
        }
        catch (e) { }
    }
    console.log(`[HARVEST] Protocol started: Range ${startId} - ${endId}`);
    const actualTotal = 250000; // Expected total entries approximately
    const next = async () => {
        if (!isRunning) {
            if (isPaused) {
                const state = {
                    lastId: startId + currentIndex - 1,
                    totalScraped: status.totalScraped,
                    errors: status.errors,
                    queueIndex: currentIndex,
                    config: { startId, endId, fromYear: options.fromYear, toYear: options.toYear }
                };
                await fs_extra_1.default.writeJson(STATE_FILE, state);
                if (io)
                    io.emit('log', '[SYSTEM] State cached. Resumable.');
            }
            return;
        }
        if (startId + currentIndex > endId) {
            isRunning = false;
            if (io)
                io.emit('log', '[SUCCESS] Harvest completed.');
            return;
        }
        const id = startId + currentIndex;
        currentIndex++;
        status.processedCount++;
        status.currentId = id;
        status.activeWorkers++;
        status.left = endId - id;
        status.percent = ((status.processedCount / (endId - startId + 1)) * 100).toFixed(4);
        if (io)
            io.emit('progress', status);
        if (io)
            io.emit('update', status);
        try {
            await scrapeId(id, io, { fromYear: options.fromYear, toYear: options.toYear });
        }
        catch (e) { }
        finally {
            status.activeWorkers--;
            // Rate limit precaution if no proxies: 
            // 90 requests/min = 1.5 per second shared across all. 
            // If we have 8 workers, each should wait about 5 seconds to be safe.
            if (!proxyManager.hasProxies()) {
                await new Promise(r => setTimeout(r, 4500));
            }
            else {
                await new Promise(r => setTimeout(r, 200));
            }
            if (isRunning)
                next();
        }
    };
    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
        workers.push(next());
        await new Promise(r => setTimeout(r, 500)); // Stagger starts
    }
    await Promise.all(workers);
    isRunning = false;
}
