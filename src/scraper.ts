
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ANIME_QUERY } from './query';
import { ProxyManager } from './proxy';
import { dbRequest, initDB } from './db';

const CONCURRENCY = 5;
const START_ID = 1;
const MAX_ID = 200000;

const RAW_DIR = path.join(process.cwd(), 'data', 'raw');
const DB_DIR = path.join(process.cwd(), 'database', 'data');

// Ensure directories exist
fs.ensureDirSync(RAW_DIR);
fs.ensureDirSync(DB_DIR);

const proxyManager = new ProxyManager();

async function downloadImage(url: string, destPath: string) {
    if (!url) return;
    try {
        if (await fs.pathExists(destPath)) return;

        const writer = fs.createWriteStream(destPath);
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            timeout: 10000
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch (error: any) {
        // Ignore image download errors
    }
}

async function scrapeId(id: number) {
    const proxy = proxyManager.getNextProxy();
    const config: any = {
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        data: {
            query: ANIME_QUERY,
            variables: { id }
        },
        timeout: 15000
    };

    if (proxy) {
        config.httpsAgent = new HttpsProxyAgent(proxy);
    }

    try {
        const response = await axios(config);
        const data = response.data;

        if (data.errors) {
            const is404 = data.errors.some((e: any) => e.status === 404 || e.message?.includes('Not Found'));
            if (is404) return { status: 'NOT_FOUND', id };
            return { status: 'ERROR', id, error: data.errors };
        }

        const media = data.data.Media;
        if (!media) return { status: 'NOT_FOUND', id };

        // 1. Save Raw JSON to File
        await fs.writeJson(path.join(RAW_DIR, `${id}.json`), data, { spaces: 2 });

        // 2. Save Processed/Organized Data to File System
        const entryDir = path.join(DB_DIR, `${id}`);
        await fs.ensureDir(entryDir);
        await fs.writeJson(path.join(entryDir, 'info.json'), media, { spaces: 2 });

        // 3. Save to PostgreSQL Database
        try {
            await dbRequest(`
                INSERT INTO anime (
                    id, title_romaji, title_english, title_native, description, 
                    format, status, season, season_year, episodes, duration, 
                    cover_image_url, banner_image_url, genres, average_score, 
                    popularity, raw_data, last_updated
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
                ON CONFLICT (id) DO UPDATE SET 
                    raw_data = EXCLUDED.raw_data,
                    last_updated = NOW();
            `, [
                media.id,
                media.title?.romaji,
                media.title?.english,
                media.title?.native,
                media.description,
                media.format,
                media.status,
                media.season,
                media.seasonYear,
                media.episodes,
                media.duration,
                media.coverImage?.extraLarge,
                media.bannerImage,
                media.genres,
                media.averageScore,
                media.popularity,
                JSON.stringify(media)
            ]);
        } catch (dbError: any) {
            console.error(`[DB ERROR] ID: ${id} - ${dbError.message}`);
        }

        // 4. Download Images
        const imagePromises = [];
        if (media.coverImage?.extraLarge) {
            imagePromises.push(downloadImage(media.coverImage.extraLarge, path.join(entryDir, 'cover.jpg')));
        }
        if (media.bannerImage) {
            imagePromises.push(downloadImage(media.bannerImage, path.join(entryDir, 'banner.jpg')));
        }
        await Promise.all(imagePromises);

        console.log(`[SUCCESS] Scraped ID: ${id} - ${media.title.romaji || 'Unknown Title'}`);
        return { status: 'SUCCESS', id };

    } catch (error: any) {
        if (error.response?.status === 404) {
            return { status: 'NOT_FOUND', id };
        }
        if (error.response?.status === 429) {
            console.warn(`[RATE LIMIT] ID: ${id} - Cooling down...`);
            await new Promise(r => setTimeout(r, 60000));
            return scrapeId(id);
        }
        console.error(`[ERROR] ID: ${id} Failed: ${error.message}`);
        return { status: 'ERROR', id, error: error.message };
    }
}

async function run() {
    await initDB();
    console.log('Starting Scraper with DB Sync...');

    const queue = Array.from({ length: MAX_ID }, (_, i) => i + 1);

    let activeWorkers = 0;
    const poolSize = CONCURRENCY;
    let index = 0;

    const next = async () => {
        if (index >= queue.length) return;
        const id = queue[index++];

        activeWorkers++;
        try {
            await scrapeId(id);
        } finally {
            activeWorkers--;
            if (!proxyManager.hasProxies()) {
                // Rate limit buffer if no proxies
                await new Promise(r => setTimeout(r, 750));
            }
            if (index < queue.length) {
                next();
            }
        }
    };

    const workers = [];
    for (let i = 0; i < poolSize; i++) {
        workers.push(next());
    }

    await Promise.all(workers);
    console.log('Scraping Complete.');
}

run();
