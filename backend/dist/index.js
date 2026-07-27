"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const http_1 = __importDefault(require("http"));
const app_1 = __importDefault(require("./app"));
const database_1 = __importDefault(require("@config/database"));
const socket_1 = require("./socket");
const verificationWorker_1 = require("@workers/verificationWorker");
const PORT = process.env.PORT || 3000;
const startServer = async () => {
    try {
        // Test database connection
        await database_1.default.$connect();
        console.log('Database connected');
        const server = http_1.default.createServer(app_1.default);
        (0, socket_1.initSocket)(server);
        server.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });
        (0, verificationWorker_1.startVerificationWorker)().catch((error) => {
            console.error('Failed to start verification worker:', error);
        });
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};
startServer();
// Graceful shutdown
process.on('SIGINT', async () => {
    await database_1.default.$disconnect();
    process.exit(0);
});
//# sourceMappingURL=index.js.map