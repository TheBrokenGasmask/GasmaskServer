const { config } = require("../../core/config");
const {getToken} = require("../auth/authentication");
const {requestUUID} = require("../../core/utilities");
const {getMemberByUuid} = require('../player/guild-cache');
const { getWynnGuild } = require("../player/wynn-api");
const { insertRaidSnapshot } = require("../../core/database");
const {raids} = require("../../core/utilities");

let discordClient = null;
let updateInterval = null;
let isUpdating = false;

async function InitializeGuildRaidTracker(client) {
        discordClient = client;
    console.log('Initializing Guild Member Tracker...');
    
    try {
        await TrackGuildRaids();
        
        updateInterval = setInterval(TrackGuildRaids, 300 * 1000); // 300-second polling
        console.log('Guild member tracker initialized with 300-second refresh interval.');
    } catch (error) {
        console.error('Failed to initialize guild member tracker:', error);
    }
}

async function TrackGuildRaids() {
    if (isUpdating) return;
    isUpdating = true;

    try {
        const guildData = await getWynnGuild();
        console.log('guildData received:', !!guildData);
        
        const raidList = getRaidList(guildData);
        console.log('raidList:');
        
        await insertAllRaidSnapshots(raidList);
    } catch (error) {
        console.error('Error fetching guild raids:', error);
    } finally {
        isUpdating = false;
    }
}

function getGuildRaidTotals(guildData) {
  const members = getAllMembers(guildData);
  const raidTotals = {};

  for (const member of members) {
    const raidList = member.globalData?.currentGuildRaids?.list ?? {};

    for (const [raidName, count] of Object.entries(raidList)) {
      raidTotals[raidName] = (raidTotals[raidName] ?? 0) + count;
    }
  }

  return raidTotals;
}

function getRaidList(guildData) {
  const members = getAllMembers(guildData); // this calls getAllMembers internally
  return Object.fromEntries(
    members.map(member => [
      member.uuid,
      {
        total: member.globalData?.currentGuildRaids?.total ?? 0,
        ...member.globalData?.currentGuildRaids?.list ?? {}
      }
    ])
  );
}

const RANKS = ['owner', 'chief', 'strategist', 'captain', 'recruiter', 'recruit'];

function getAllMembers(guildData) {
  const members = guildData.members;
  const result = [];
  for (const rank of RANKS) {
    const rankGroup = members[rank];
    if (!rankGroup) continue;
    for (const [uuid, data] of Object.entries(rankGroup)) {
      result.push({ uuid, rank, ...data });
    }
  }
  return result;
}

async function insertAllRaidSnapshots(members) {
    const capturedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

    for (const [uuid, data] of Object.entries(members)) {
        const raidCounts = [0, 0, 0, 0, 0];

        for (const [raidName, count] of Object.entries(data)) {
            if (raidName === 'total') continue;
            const raidId = raids.find(r => r.name === raidName)?.id;
            if (raidId === undefined || raidId === -1) continue;
            raidCounts[raidId] = count;
        }

        const total = data.total ?? 0;
        await insertRaidSnapshot(uuid, raidCounts, total, capturedAt);
    }
}





module.exports = { InitializeGuildRaidTracker, TrackGuildRaids, getAllMembers, getGuildRaidTotals, getRaidList, insertAllRaidSnapshots };

/*
 * member -> [owner, chief, strategist, captain, recruiter, recruit] -> IGN -> globaldata -> currentguildraids -> total name:string & [list] -> raid:string 
 * 
 * 
 * 
 */