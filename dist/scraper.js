"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const https_proxy_agent_1 = require("https-proxy-agent");
const query_1 = require("./query");
const proxy_1 = require("./proxy");
const db_1 = require("./db");
const CONCURRENCY = 5;
const START_ID = 1;
const MAX_ID = 200000;
const RAW_DIR = path_1.default.join(process.cwd(), 'data', 'raw');
const DB_DIR = path_1.default.join(process.cwd(), 'database', 'data');
// Ensure directories exist
fs_extra_1.default.ensureDirSync(RAW_DIR);
fs_extra_1.default.ensureDirSync(DB_DIR);
const proxyManager = new proxy_1.ProxyManager();
async function downloadImage(url, destPath) {
    if (!url)
        return;
    try {
        if (await fs_extra_1.default.pathExists(destPath))
            return;
        const writer = fs_extra_1.default.createWriteStream(destPath);
        const response = await (0, axios_1.default)({
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
    }
    catch (error) {
        // Ignore image download errors
    }
}
async function scrapeId(id) {
    const proxy = proxyManager.getNextProxy();
    const config = {
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        data: {
            query: query_1.ANIME_QUERY,
            variables: { id }
        },
        timeout: 15000
    };
    if (proxy) {
        config.httpsAgent = new https_proxy_agent_1.HttpsProxyAgent(proxy);
    }
    try {
        const response = await (0, axios_1.default)(config);
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
        // 1. Save Raw JSON to File
        await fs_extra_1.default.writeJson(path_1.default.join(RAW_DIR, `${id}.json`), data, { spaces: 2 });
        // 2. Save Processed/Organized Data to File System
        const entryDir = path_1.default.join(DB_DIR, `${id}`);
        await fs_extra_1.default.ensureDir(entryDir);
        await fs_extra_1.default.writeJson(path_1.default.join(entryDir, 'info.json'), media, { spaces: 2 });
        // 3. Save to PostgreSQL Database
        try {
            await (0, db_1.dbRequest)(`
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
        }
        catch (dbError) {
            console.error(`[DB ERROR] ID: ${id} - ${dbError.message}`);
        }
        // 4. Download Images
        const imagePromises = [];
        if (media.coverImage?.extraLarge) {
            imagePromises.push(downloadImage(media.coverImage.extraLarge, path_1.default.join(entryDir, 'cover.jpg')));
        }
        if (media.bannerImage) {
            imagePromises.push(downloadImage(media.bannerImage, path_1.default.join(entryDir, 'banner.jpg')));
        }
        await Promise.all(imagePromises);
        console.log(`[SUCCESS] Scraped ID: ${id} - ${media.title.romaji || 'Unknown Title'}`);
        return { status: 'SUCCESS', id };
    }
    catch (error) {
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
    await (0, db_1.initDB)();
    console.log('Starting Scraper with DB Sync...');
    const queue = Array.from({ length: MAX_ID }, (_, i) => i + 1);
    let activeWorkers = 0;
    const poolSize = CONCURRENCY;
    let index = 0;
    const next = async () => {
        if (index >= queue.length)
            return;
        const id = queue[index++];
        activeWorkers++;
        try {
            await scrapeId(id);
        }
        finally {
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
