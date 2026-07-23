"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const profilePersistence_1 = require("../profilePersistence");
(0, node_test_1.default)('buildUserProfileUpdateData persists provided profile fields', () => {
    const result = (0, profilePersistence_1.buildUserProfileUpdateData)({
        fullName: 'Jane Doe',
        phone: '09171234567',
        avatar: 'https://cdn.example.com/avatar.png',
    });
    strict_1.default.deepEqual(result, {
        fullName: 'Jane Doe',
        phone: '09171234567',
        avatar: 'https://cdn.example.com/avatar.png',
    });
});
(0, node_test_1.default)('buildWorkerProfileUpdateData persists worker fields', () => {
    const result = (0, profilePersistence_1.buildWorkerProfileUpdateData)({
        bio: 'Certified electrician',
        yearsOfExperience: 8,
        serviceArea: 'Quezon City',
    });
    strict_1.default.deepEqual(result, {
        bio: 'Certified electrician',
        yearsOfExperience: 8,
        serviceArea: 'Quezon City',
    });
});
//# sourceMappingURL=profilePersistence.test.js.map