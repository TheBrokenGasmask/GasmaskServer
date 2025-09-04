const {insertWar} = require('../../core/database');

class WarReportService {

    async handleWarReport(client, packet) {
        const { reporter, timeInWar, towerEhp, towerDps, territory, ownerGuild } = packet.data;


        await insertWar(reporter, timeInWar, towerEhp, towerEhp, territory, ownerGuild);
    }
}