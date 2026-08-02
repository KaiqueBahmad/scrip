/** `npm run reset` — clears the data, keeps the schema (specs.md:45). */
import { loadConfig } from '../config';
import { openDb, resetData } from './index';

const config = loadConfig();
const db = openDb({ databasePath: config.databasePath });

resetData(db);
db.close();

console.log(`[pseudopay] reset ${config.databasePath} (schema kept, data cleared)`);
