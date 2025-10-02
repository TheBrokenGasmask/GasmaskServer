const {insertWar} = require('../../core/database');

class WarReportService {

    async handleWarReport(client, packet) {
        const { reporter, timeInWar, towerEhp, towerDps, territory, ownerGuild } = packet.data;

        await insertWar(reporter, timeInWar, towerEhp, towerDps, territory, ownerGuild);
    }

    getWarDifficulty(towerEhp, towerDps) {
        if (towerDps < 5_000 || towerEhp < 10_000_000) return Difficulty.EASY;
        else if (towerDps < 35_000 || towerEhp < 40_500_000) return Difficulty.MEDIUM;
        else if (towerDps < 150_000 || towerEhp < 150_000_000) return Difficulty.HARD;
        else return Difficulty.EXTREME;
    }

    getDifficultyIndex(difficulty) {
        if (difficulty === Difficulty.ALL_WARS) return -1;
        return Object.values(Difficulty).indexOf(difficulty);
    }

    getDifficultyFromIndex(index) {
        if (index === -1) return Difficulty.ALL_WARS;
        return Object.values(Difficulty)[index];
    }
}

const Difficulty = {
    EASY: 'Easy',
    MEDIUM: 'Medium',
    HARD: 'Hard',
    EXTREME: 'Extreme',
    ALL_WARS: 'All Wars'
}

const warService = new WarReportService();

module.exports = { WarReportService, warService, Difficulty };