"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDB = exports.dbRequest = void 0;
const pg_1 = require("pg");
// Neon PostgreSQL Connection
const connectionString = 'postgresql://neondb_owner:npg_6Stz4KYmrRuV@ep-muddy-frost-a4n90njq-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require';
const pool = new pg_1.Pool({
    connectionString,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});
const dbRequest = async (text, params) => {
    try {
        return await pool.query(text, params);
    }
    catch (err) {
        console.error('[DB ERROR]', err.message);
        throw err;
    }
};
exports.dbRequest = dbRequest;
const initDB = async () => {
    try {
        // Create table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS anime (
                id INTEGER PRIMARY KEY,
                raw_data JSONB
            );
        `);
        // Migration: Add columns to existing table if they don't exist
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
        console.log("[SYSTEM] Database tables and schema verified.");
    }
    catch (err) {
        console.error("[CRITICAL] DB Migration Failed:", err.message);
        process.exit(1);
    }
};
exports.initDB = initDB;
