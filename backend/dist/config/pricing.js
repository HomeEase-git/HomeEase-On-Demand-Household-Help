"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WITHHOLDING_TAX_RATE = exports.COMMISSION_RATE = void 0;
const parseRate = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(Math.max(parsed, 0), 1);
};
exports.COMMISSION_RATE = parseRate(process.env.COMMISSION_RATE, 0.1);
exports.WITHHOLDING_TAX_RATE = parseRate(process.env.WITHHOLDING_TAX_RATE, 0.05);
//# sourceMappingURL=pricing.js.map