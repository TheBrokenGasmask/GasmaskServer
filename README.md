# WynnTracker

**WynnTracker** is a Node.js-based application and Discord Bot designed to manage and track raid-related activities for a guild in the game *Wynncraft*. It provides an API for authentication, reporting raids, toggling aspects, and more.

---

## Features

- **Authentication**: Secure token-based authentication for users.
- **Raid Reporting**: Submit and manage raid reports.
- **Aspect Management**: Toggle and manage owed guild aspects for players.
- **Guild Integration**: Ensures users are part of the guild before performing certain actions.
- **Database Integration**: Stores and retrieves data using a MySQL database.
- **Leaderboards**: View and manage a leaderboard of players based on their raid contributions.

---

## Prerequisites

- **Node.js**: Ensure you have Node.js installed (v14 or higher recommended).
- **MySQL**: A MySQL database is required for storing application data.
- **npm**: Comes with Node.js for managing dependencies.

---

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/wiji1/WynnTrackerServer.git
   cd WynnTrackerServer
   ```
2. Install dependencies:

   ```bash
    npm install
    ```
3. Auto-generate a ```config.json``` file by running the server:

   ```bash
   npm run start
   ```

4. Fill in ```config.json``` with the appropriate values:
    ```json
   {  
      "token": "DISCORD_AUTH_TOKEN",
      "clientId": "DISCORD_CLIENT_ID",
      "guild-tag": "GUILD_TAG",
      "minimum-rank": 2,
      "host-port": 80,
      "sql": {
        "host": "DB_HOST",
        "user": "DB_USER",
        "password": "DB_PASSWORD",
        "database": "DB_NAME"
      }
    }
   ```


5. Start the server:

   ```bash
   npm run start
   ```
   
---

## Deploying to Kubernetes (optional)

Running the server with `npm run start` as described above needs nothing from
this section.

A Helm chart is available in [`deploy/helm/wynn-tracker-server`](deploy/helm/wynn-tracker-server),
with a `Dockerfile` at the repo root. It renders `config.json` into a Secret,
exposes the API and the `/ws` WebSocket through an ingress, and can obtain and
auto-renew a Let's Encrypt certificate via cert-manager.

```bash
docker build -t wynn-tracker-server:latest .
helm install wynn-tracker deploy/helm/wynn-tracker-server \
  --namespace wynntracker --create-namespace --values my-values.yaml
```

See the [chart README](deploy/helm/wynn-tracker-server/README.md) for
configuration and TLS options.

---

## Usage
Have members of your guild use the **WynnTracker Mod** to relay information to the server.

It is available to [Download on Modrinth](https://modrinth.com/mod/wynntracker), or to [Build on GitHub](https://github.com/wiji1/WynnTrackerClient.git).

The mod requires [Mod Menu](https://modrinth.com/mod/modmenu) and [Cloth Config API](https://modrinth.com/mod/cloth-config).

Upon loading the mod, have guild members enter the HTTP URL of your server in the mod's in-game settings. This will allow the mod to communicate with your server and send raid reports.
---
## Contributing
Contributions are welcome! Please follow these steps:
1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and commit them.
4. Push to your branch.
5. Create a pull request explaining your changes.

