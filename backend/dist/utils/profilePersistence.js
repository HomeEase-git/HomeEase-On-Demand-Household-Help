"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWorkerProfileUpdateData = exports.buildUserProfileUpdateData = void 0;
const buildUserProfileUpdateData = (data) => {
    const updateData = {};
    if (data.fullName !== undefined)
        updateData.fullName = data.fullName;
    if (data.phone !== undefined)
        updateData.phone = data.phone;
    if (data.avatar !== undefined)
        updateData.avatar = data.avatar;
    return updateData;
};
exports.buildUserProfileUpdateData = buildUserProfileUpdateData;
const buildWorkerProfileUpdateData = (data) => {
    const updateData = {};
    if (data.bio !== undefined)
        updateData.bio = data.bio;
    if (data.yearsOfExperience !== undefined)
        updateData.yearsOfExperience = data.yearsOfExperience;
    if (data.serviceArea !== undefined)
        updateData.serviceArea = data.serviceArea;
    return updateData;
};
exports.buildWorkerProfileUpdateData = buildWorkerProfileUpdateData;
//# sourceMappingURL=profilePersistence.js.map