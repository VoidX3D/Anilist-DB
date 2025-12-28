"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./db");
(async () => {
    try {
        await (0, db_1.dbRequest)('TRUNCATE TABLE anime, anime_relations RESTART IDENTITY CASCADE;');
        console.log('Database cleared.');
    }
    catch (err) {
        console.error(err);
    }
})();
