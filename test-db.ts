
import { Pool } from 'pg';

const connectionString = 'postgresql://neondb_owner:npg_6Stz4KYmrRuV@ep-muddy-frost-a4n90njq-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
    connectionString,
    ssl: true,
});

(async () => {
    try {
        console.log("Connecting...");
        const client = await pool.connect();
        console.log("Connected!");
        const res = await client.query('SELECT NOW()');
        console.log(res.rows[0]);
        client.release();
    } catch (err) {
        console.error("Connection error", err);
    } finally {
        await pool.end();
    }
})();
