
import { dbRequest } from './db';

(async () => {
    try {
        await dbRequest('TRUNCATE TABLE anime, anime_relations RESTART IDENTITY CASCADE;');
        console.log('Database cleared.');
    } catch (err) {
        console.error(err);
    }
})();
