// Bitcraft Inventory Viewer
// Fetches data from bitjita.com API and displays aggregated inventory

const API_BASE = 'https://young-base-bcd2.chris-milazzo.workers.dev/proxy';

class InventoryViewer {
    constructor() {
        this.players = new Map(); // entityId -> { username, items: [] }
        this.init();
    }

    init() {
        // DOM elements
        this.playerSearchInput = document.getElementById('player-search');
        this.searchBtn = document.getElementById('search-btn');
        this.searchResults = document.getElementById('search-results');
        this.playerList = document.getElementById('player-list');
        this.groupBySelect = document.getElementById('group-by');
        this.filterTierSelect = document.getElementById('filter-tier');
        this.filterRaritySelect = document.getElementById('filter-rarity');
        this.itemSearchInput = document.getElementById('item-search');
        this.inventoryContent = document.getElementById('inventory-content');
        this.statPlayers = document.getElementById('stat-players');
        this.statUnique = document.getElementById('stat-unique');
        this.statTotal = document.getElementById('stat-total');
        this.refreshBtn = document.getElementById('refresh-btn');
        this.exportBtn = document.getElementById('export-btn');
        this.clearBtn = document.getElementById('clear-btn');
        this.loadingOverlay = document.getElementById('loading-overlay');

        // Event listeners
        this.searchBtn.addEventListener('click', () => this.searchPlayer());
        this.playerSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.searchPlayer();
        });
        this.groupBySelect.addEventListener('change', () => this.render());
        this.filterTierSelect.addEventListener('change', () => this.render());
        this.filterRaritySelect.addEventListener('change', () => this.render());
        this.itemSearchInput.addEventListener('input', () => this.render());
        this.refreshBtn.addEventListener('click', () => this.refreshAll());
        this.exportBtn.addEventListener('click', () => this.exportCSV());
        this.clearBtn.addEventListener('click', () => this.clearAll());

        this.render();
    }

    showLoading() {
        this.loadingOverlay.classList.remove('hidden');
    }

    hideLoading() {
        this.loadingOverlay.classList.add('hidden');
    }

    // Decode SvelteKit __data.json format (devalue format)
    // In devalue format, all numbers in objects are references to indices in the data array
    // The actual values are stored in the data array itself
    decodeSvelteKitData(json) {
        if (!json || !json.nodes) return null;

        // Find the data node
        const dataNode = json.nodes.find(n => n.type === 'data' && n.data);
        if (!dataNode) return null;

        const data = dataNode.data;
        const hydrated = new Array(data.length);

        // Hydrate a value at a given index
        const hydrate = (index) => {
            // Special devalue codes (negative numbers)
            if (index === -1) return undefined;
            if (index === -3) return NaN;
            if (index === -4) return Infinity;
            if (index === -5) return -Infinity;
            if (index === -6) return -0;

            // Already hydrated
            if (index in hydrated) {
                return hydrated[index];
            }

            const value = data[index];

            // Primitives - return as-is
            if (typeof value === 'string' || typeof value === 'boolean' || value === null) {
                hydrated[index] = value;
                return value;
            }

            // Numbers in the data array are literal values
            if (typeof value === 'number') {
                hydrated[index] = value;
                return value;
            }

            // Arrays - hydrate each element (elements are references)
            if (Array.isArray(value)) {
                const arr = [];
                hydrated[index] = arr; // Store early for circular refs
                for (const ref of value) {
                    arr.push(hydrate(ref));
                }
                return arr;
            }

            // Objects - hydrate each property value (values are references)
            if (typeof value === 'object') {
                const obj = {};
                hydrated[index] = obj; // Store early for circular refs
                for (const [key, ref] of Object.entries(value)) {
                    obj[key] = hydrate(ref);
                }
                return obj;
            }

            return value;
        };

        return hydrate(0);
    }

    async searchPlayer() {
        const query = this.playerSearchInput.value.trim();
        if (!query) return;

        this.showLoading();
        this.searchResults.innerHTML = '';

        try {
            const response = await fetch(
                `${API_BASE}/players/__data.json?q=${encodeURIComponent(query)}&x-sveltekit-invalidated=01`
            );
            const json = await response.json();
            const decoded = this.decodeSvelteKitData(json);

            if (!decoded || !decoded.players || decoded.players.length === 0) {
                this.searchResults.innerHTML = '<p class="error-message">No players found.</p>';
                this.hideLoading();
                return;
            }

            this.searchResults.innerHTML = decoded.players.map(player => `
                <div class="search-result-item">
                    <span>${this.escapeHtml(player.username)}</span>
                    <button onclick="viewer.addPlayer('${player.entityId}', '${this.escapeHtml(player.username)}')">
                        Add
                    </button>
                </div>
            `).join('');
        } catch (error) {
            console.error('Search error:', error);
            this.searchResults.innerHTML = '<p class="error-message">Error searching for player. Try again.</p>';
        }

        this.hideLoading();
    }

    async addPlayer(entityId, username) {
        if (this.players.has(entityId)) {
            alert(`${username} is already added.`);
            return;
        }

        this.showLoading();
        this.searchResults.innerHTML = '';
        this.playerSearchInput.value = '';

        try {
            const items = await this.fetchPlayerInventory(entityId);
            this.players.set(entityId, { username, items });
            this.render();
        } catch (error) {
            console.error('Error fetching inventory:', error);
            alert(`Error loading inventory for ${username}.`);
        }

        this.hideLoading();
    }

    async fetchPlayerInventory(entityId) {
        const response = await fetch(
            `${API_BASE}/players/${entityId}/__data.json?x-sveltekit-invalidated=01`
        );
        const json = await response.json();
        const decoded = this.decodeSvelteKitData(json);

        if (!decoded) {
            throw new Error('Failed to decode player data');
        }

        const items = [];

        // Structure: decoded.inventories = { inventories: [...containers], items: {...}, cargos: {...} }
        if (decoded.inventories && typeof decoded.inventories === 'object') {
            const invData = decoded.inventories;
            const containers = invData.inventories || [];
            const itemsLookup = invData.items || {};
            const cargosLookup = invData.cargos || {};

            // Containers to skip (equipped items, not actual inventory)
            const skipContainers = new Set(['Wallet', 'Toolbelt']);

            // Process each inventory container (Storage, Bank, etc.)
            for (const container of containers) {
                const locationName = container.inventoryName || container.name || 'Unknown';

                // Skip Wallet and Toolbelt - these are equipped items, not inventory
                if (skipContainers.has(locationName)) continue;

                const pockets = container.pockets || [];

                for (const pocket of pockets) {
                    if (!pocket.contents) continue;

                    const contents = pocket.contents;
                    let quantity = contents.quantity;

                    // The itemId/item_id may be resolved to an object or still be a number for lookup
                    const itemData = contents.itemId || contents.item_id;

                    // Handle quantity - it might be resolved correctly, or might need fixing
                    if (typeof quantity !== 'number') {
                        if (typeof quantity === 'string' && /^\d+$/.test(quantity)) {
                            quantity = parseInt(quantity);
                        } else {
                            continue;
                        }
                    }

                    if (quantity < 1) continue;

                    // itemData could be the resolved item object or a number for lookup
                    if (itemData && typeof itemData === 'object' && itemData.name) {
                        this.extractItemFromDetails(itemData, quantity, items, entityId, locationName);
                    } else if (typeof itemData === 'number') {
                        // Look up in items or cargos
                        const details = itemsLookup[itemData] || cargosLookup[itemData];
                        if (details) {
                            this.extractItemFromDetails(details, quantity, items, entityId, locationName);
                        }
                    }
                }
            }
        }

        return items;
    }

    extractItemFromDetails(itemDetails, quantity, items, playerId, location) {
        if (!itemDetails) return;

        const name = itemDetails.name;
        const rarity = itemDetails.rarityStr || itemDetails.rarity;

        if (name && typeof name === 'string') {
            // Filter out non-inventory items (skills, badges, cosmetics, etc.)
            if (this.shouldSkipItem(name)) {
                return;
            }

            // Derive tier from item name since the tier field is unreliable
            const tier = this.deriveTierFromName(name);

            items.push({
                name: name,
                tier: tier,
                rarity: this.normalizeRarity(rarity),
                count: quantity,
                playerId,
                location
            });
        }
    }

    deriveTierFromName(name) {
        // Tier prefixes in item names
        const tierPrefixes = {
            'Rough': 0,
            'Primitive': 0,
            'Basic': 1,
            'Simple': 2,
            'Improved': 2,
            'Sturdy': 3,
            'Quality': 3,
            'Infused': 3,
            'Fine': 4,
            'Essential': 4,
            'Superior': 5,
            'Exquisite': 5,
            'Succulent': 5,
            'Peerless': 6,
            'Ornate': 7,
            'Ambrosial': 6,
            'Flavorful': 7,
            'Aurumite': 7,
            'Pristine': 8,
            'Celestium': 8,
            'Luminite': 5,
            'Rathium': 6,
            'Zesty': 3,
            'Plain': 0,
            'Novice': 2
        };

        for (const [prefix, tier] of Object.entries(tierPrefixes)) {
            if (name.startsWith(prefix + ' ')) {
                return tier;
            }
        }

        // Check for special items
        if (name.includes('Hex Coin')) return -1;
        if (name.includes('Ancient Metal')) return -1;

        // Default
        return 0;
    }

    extractItem(item, items, playerId, location = 'Unknown') {
        if (!item) return;

        // Check if item has name (field is 'name') and rarityStr
        const name = item.name;
        const rarity = item.rarityStr || item.rarity;
        const tier = item.tier;
        const quantity = item.quantity || item.count || 1;

        if (name && typeof name === 'string') {
            // Filter out non-inventory items (skills, badges, cosmetics, etc.)
            if (this.shouldSkipItem(name)) {
                return;
            }

            items.push({
                name: name,
                tier: this.normalizeTier(tier),
                rarity: this.normalizeRarity(rarity),
                count: quantity,
                playerId,
                location
            });
        }
    }

    shouldSkipItem(name) {
        // Prefixes that indicate non-inventory items (skills, badges, cosmetics)
        const skipPrefixes = [
            'Professional',
            'Collectible',
            'Adept',
            'Apprentice',
            'Novice',
            'Expert',
            'Master',
            'Grandmaster',
            'Legendary',  // As a prefix for skills
            'Mythical',   // As a prefix for skills
        ];

        // Check if name starts with any skip prefix
        for (const prefix of skipPrefixes) {
            if (name.startsWith(prefix + ' ')) {
                return true;
            }
        }

        return false;
    }

    normalizeTier(tier) {
        // Handle null/undefined
        if (tier === undefined || tier === null) return 0;

        // Handle boolean (bad data)
        if (typeof tier === 'boolean') return 0;

        // Handle string tiers
        if (typeof tier === 'string') {
            // Check for tier names that map to numbers
            const tierMap = {
                'Primitive': 0,
                'Basic': 1,
                'Improved': 2,
                'Quality': 3,
                'Fine': 4,
                'Superior': 5,
                'Ornate': 6,
                'Aurumite': 7,
                'Celestium': 8,
                'Currency': -1,
                'Special': -1
            };
            // Check if it's a known tier name
            for (const [name, num] of Object.entries(tierMap)) {
                if (tier.includes(name)) return num;
            }
            // Try to extract number
            const match = tier.match(/-?\d+/);
            return match ? parseInt(match[0]) : 0;
        }

        // Handle number - but some are clearly wrong (like 19998, 6922186)
        // Valid tiers are -1 to 8
        if (typeof tier === 'number') {
            if (tier >= -1 && tier <= 8) {
                return tier;
            }
            // Invalid tier number - return 0
            return 0;
        }

        return 0;
    }

    normalizeRarity(rarity) {
        if (!rarity) return 'Common';
        if (typeof rarity !== 'string') return 'Common';
        // Normalize rarity string
        const r = rarity.trim();
        if (r.includes('Common')) return 'Common';
        if (r.includes('Uncommon')) return 'Uncommon';
        if (r.includes('Rare')) return 'Rare';
        if (r.includes('Epic')) return 'Epic';
        if (r.includes('Legendary')) return 'Legendary';
        if (r.includes('Mythic')) return 'Mythic';
        return r;
    }

    extractItems(obj, items, playerId, seen = new Set()) {
        if (!obj || typeof obj !== 'object') return;

        // Prevent circular reference issues
        const objId = JSON.stringify(obj).substring(0, 100);
        if (seen.has(objId)) return;
        seen.add(objId);

        // Check if this object looks like an inventory item
        if (obj.name && obj.tier !== undefined && obj.rarity) {
            const quantity = obj.quantity || obj.count || 1;
            items.push({
                name: String(obj.name),
                tier: obj.tier,
                rarity: String(obj.rarity),
                count: quantity,
                playerId
            });
            return;
        }

        // Check for contents array with item data
        if (obj.contents && obj.contents.name && obj.contents.rarity) {
            const quantity = obj.contents.quantity || obj.contents.count || 1;
            items.push({
                name: String(obj.contents.name),
                tier: obj.contents.tier,
                rarity: String(obj.contents.rarity),
                count: quantity,
                playerId
            });
        }

        // Recursively search through arrays and objects
        if (Array.isArray(obj)) {
            obj.forEach(item => this.extractItems(item, items, playerId, seen));
        } else {
            for (const value of Object.values(obj)) {
                if (value && typeof value === 'object') {
                    this.extractItems(value, items, playerId, seen);
                }
            }
        }
    }

    removePlayer(entityId) {
        this.players.delete(entityId);
        this.render();
    }

    async refreshAll() {
        if (this.players.size === 0) return;

        this.showLoading();

        for (const [entityId, playerData] of this.players) {
            try {
                const items = await this.fetchPlayerInventory(entityId);
                playerData.items = items;
            } catch (error) {
                console.error(`Error refreshing ${playerData.username}:`, error);
            }
        }

        this.render();
        this.hideLoading();
    }

    getAllItems() {
        const allItems = [];
        for (const [entityId, playerData] of this.players) {
            for (const item of playerData.items) {
                allItems.push({
                    ...item,
                    playerName: playerData.username
                });
            }
        }
        return allItems;
    }

    getFilteredItems() {
        let items = this.getAllItems();

        // Filter by tier
        const tierFilter = this.filterTierSelect.value;
        if (tierFilter !== 'all') {
            items = items.filter(i => i.tier === parseInt(tierFilter));
        }

        // Filter by rarity
        const rarityFilter = this.filterRaritySelect.value;
        if (rarityFilter !== 'all') {
            items = items.filter(i => i.rarity === rarityFilter);
        }

        // Filter by search term
        const search = this.itemSearchInput.value.toLowerCase().trim();
        if (search) {
            items = items.filter(i => i.name.toLowerCase().includes(search));
        }

        return items;
    }

    aggregateItems(items) {
        // Aggregate same items (combine counts)
        const aggregated = new Map();

        for (const item of items) {
            // Key by name + tier + rarity (and player if grouping by player)
            const groupBy = this.groupBySelect.value;
            const key = groupBy === 'player'
                ? `${item.name}|${item.tier}|${item.rarity}|${item.playerName}`
                : `${item.name}|${item.tier}|${item.rarity}`;

            if (aggregated.has(key)) {
                aggregated.get(key).count += item.count;
            } else {
                aggregated.set(key, { ...item });
            }
        }

        return Array.from(aggregated.values());
    }

    render() {
        this.renderPlayerList();
        this.renderInventory();
        this.updateStats();
    }

    renderPlayerList() {
        if (this.players.size === 0) {
            this.playerList.innerHTML = '<p class="empty-state">No players added yet. Search for a player above.</p>';
            return;
        }

        this.playerList.innerHTML = Array.from(this.players.entries()).map(([entityId, data]) => `
            <div class="player-chip">
                <span>${this.escapeHtml(data.username)}</span>
                <span>(${data.items.length} items)</span>
                <button class="remove-btn" onclick="viewer.removePlayer('${entityId}')">&times;</button>
            </div>
        `).join('');
    }

    renderInventory() {
        if (this.players.size === 0) {
            this.inventoryContent.innerHTML = '<p class="empty-state">Add a player to view their inventory.</p>';
            return;
        }

        const items = this.getFilteredItems();
        const aggregated = this.aggregateItems(items);

        if (aggregated.length === 0) {
            this.inventoryContent.innerHTML = '<p class="empty-state">No items match your filters.</p>';
            return;
        }

        const groupBy = this.groupBySelect.value;

        if (groupBy === 'none') {
            this.renderItemTable(aggregated);
        } else {
            this.renderGroupedItems(aggregated, groupBy);
        }
    }

    renderItemTable(items, showPlayer = true) {
        // Sort by name
        items.sort((a, b) => a.name.localeCompare(b.name));

        const showPlayerColumn = showPlayer && this.players.size > 1 && this.groupBySelect.value !== 'player';

        return `
            <table class="inventory-table">
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Tier</th>
                        <th>Rarity</th>
                        <th>Count</th>
                        ${showPlayerColumn ? '<th>Player</th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr>
                            <td class="item-name">${this.escapeHtml(item.name)}</td>
                            <td><span class="tier-badge">T${item.tier}</span></td>
                            <td class="rarity-${(item.rarity || 'common').toLowerCase()}">${item.rarity || 'Unknown'}</td>
                            <td class="count-value">${item.count.toLocaleString()}</td>
                            ${showPlayerColumn ? `<td><span class="player-tag">${this.escapeHtml(item.playerName)}</span></td>` : ''}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    renderGroupedItems(items, groupBy) {
        const groups = new Map();

        for (const item of items) {
            let key;
            if (groupBy === 'tier') {
                key = `Tier ${item.tier}`;
            } else if (groupBy === 'rarity') {
                key = item.rarity;
            } else if (groupBy === 'player') {
                key = item.playerName;
            }

            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(item);
        }

        // Sort groups
        const sortedGroups = Array.from(groups.entries());
        if (groupBy === 'tier') {
            sortedGroups.sort((a, b) => {
                const tierA = parseInt(a[0].replace('Tier ', ''));
                const tierB = parseInt(b[0].replace('Tier ', ''));
                return tierB - tierA; // Highest tier first
            });
        } else if (groupBy === 'rarity') {
            const rarityOrder = ['Mythic', 'Legendary', 'Epic', 'Rare', 'Uncommon', 'Common'];
            sortedGroups.sort((a, b) => rarityOrder.indexOf(a[0]) - rarityOrder.indexOf(b[0]));
        } else {
            sortedGroups.sort((a, b) => a[0].localeCompare(b[0]));
        }

        this.inventoryContent.innerHTML = sortedGroups.map(([groupName, groupItems]) => {
            const totalCount = groupItems.reduce((sum, i) => sum + i.count, 0);
            return `
                <div class="inventory-group">
                    <div class="group-header ${groupBy === 'rarity' ? 'rarity-' + groupName.toLowerCase() : ''}">
                        <span>${groupName}</span>
                        <span class="group-count">${groupItems.length} items (${totalCount.toLocaleString()} total)</span>
                    </div>
                    ${this.renderItemTable(groupItems, groupBy !== 'player')}
                </div>
            `;
        }).join('');
    }

    updateStats() {
        this.statPlayers.textContent = this.players.size;

        const items = this.getFilteredItems();
        const aggregated = this.aggregateItems(items);

        this.statUnique.textContent = aggregated.length;
        this.statTotal.textContent = items.reduce((sum, i) => sum + i.count, 0).toLocaleString();
    }

    exportCSV() {
        const items = this.getFilteredItems();
        const aggregated = this.aggregateItems(items);

        if (aggregated.length === 0) {
            alert('No items to export.');
            return;
        }

        // Sort by name
        aggregated.sort((a, b) => a.name.localeCompare(b.name));

        const headers = ['Name', 'Tier', 'Rarity', 'Count'];
        if (this.players.size > 1) {
            headers.push('Player');
        }

        const rows = aggregated.map(item => {
            const row = [
                `"${item.name}"`,
                item.tier,
                item.rarity,
                item.count
            ];
            if (this.players.size > 1) {
                row.push(`"${item.playerName}"`);
            }
            return row.join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bitcraft-inventory-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    clearAll() {
        if (this.players.size === 0) return;
        if (confirm('Remove all players and clear inventory data?')) {
            this.players.clear();
            this.render();
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize
const viewer = new InventoryViewer();
