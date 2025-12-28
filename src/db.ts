
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

export const dbRequest = async (text: string, params?: any[]) => {
    try {
        return await pool.query(text, params);
    } catch (err: any) {
        console.error('[DB ERROR]', err.message);
        throw err;
    }
};

export const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS anime (
                id INTEGER PRIMARY KEY,
                raw_data JSONB
            );
        `);

        const columns = [
            ['title_romaji', 'TEXT'],
            ['title_english', 'TEXT'],
            ['title_native', 'TEXT'],
            ['description', 'TEXT'],
            ['type', 'TEXT'],
            ['format', 'TEXT'],
            ['status', 'TEXT'],
            ['season', 'TEXT'],
            ['season_year', 'INTEGER'],
            ['episodes', 'INTEGER'],
            ['duration', 'INTEGER'],
            ['cover_image_url', 'TEXT'],
            ['banner_image_url', 'TEXT'],
            ['genres', 'TEXT[]'],
            ['average_score', 'INTEGER'],
            ['popularity', 'INTEGER'],
            ['last_updated', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP']
        ];

        for (const [col, type] of columns) {
            await pool.query(`ALTER TABLE anime ADD COLUMN IF NOT EXISTS ${col} ${type}`).catch(() => { });
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS anime_relations (
                parent_id INTEGER REFERENCES anime(id) ON DELETE CASCADE,
                related_id INTEGER,
                relation_type TEXT,
                PRIMARY KEY (parent_id, related_id)
            );
            CREATE INDEX IF NOT EXISTS idx_anime_type ON anime(type);
            CREATE INDEX IF NOT EXISTS idx_anime_year ON anime(season_year);
        `);

        console.log("[SYSTEM] Database security credentials loaded from .env");
    } catch (err: any) {
        console.error("[CRITICAL] Database Initialization Failed:", err.message);
        process.exit(1);
    }
}
