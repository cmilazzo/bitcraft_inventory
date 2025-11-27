// Bitcraft Inventory Viewer
// Fetches data from bitjita.com API and displays aggregated inventory

const API_BASE = 'https://bcproxy.bitcraft-data.com/proxy';

// Current view state
let currentView = 'inventory';

// Package contents mapping: base item suffix -> quantity per package
// Package names follow pattern: "[Tier Prefix] [Base Item] Package"
// e.g., "Simple Clay Lump Package" contains 500 "Simple Clay Lump"
const PACKAGE_CONTENTS = {
    'Filet Package': 500,
    'Brick Package': 100,
    'Clay Lump Package': 500,
    'Plank Package': 100,
    'Cloth Package': 100,
    'Pebbles Package': 1000,
    'Raw Meat Package': 500,
    'Bark Package': 500,
    'Tannin Package': 500,
    'Ingot Package': 100,
    'Fiber Package': 1000,
    'Leather Package': 100,
    'Raw Pelt Package': 100,
    'Fish Oil Package': 500,
    'Flower Package': 500,
    'Pitch Package': 500,
    'Rope Package': 100,
    'Vial Package': 100,
    'Parchment Package': 200,
    'Pigment Package': 200,
    'Ink Package': 200,
    'Stone Carving Package': 100
};

class InventoryViewer {
    constructor() {
        this.players = new Map(); // entityId -> { username, items: [] }
        this.itemDatabase = new Map(); // itemId -> { name, tier, rarity, ... }
        this.itemDatabaseLoaded = false;
        this.expandPackages = true; // Whether to add package contents to base item counts
        this.init();
    }

    async init() {
        // DOM elements
        this.playerSearchInput = document.getElementById('player-search');
        this.searchBtn = document.getElementById('search-btn');
        this.searchResults = document.getElementById('search-results');
        this.playerList = document.getElementById('player-list');
        this.groupBySelect = document.getElementById('group-by');
        this.filterTierSelect = document.getElementById('filter-tier');
        this.filterRaritySelect = document.getElementById('filter-rarity');
        this.filterTagSelect = document.getElementById('filter-tag');
        this.sortBySelect = document.getElementById('sort-by');
        this.sortOrderSelect = document.getElementById('sort-order');
        this.itemSearchInput = document.getElementById('item-search');
        this.inventoryContent = document.getElementById('inventory-content');
        this.statPlayers = document.getElementById('stat-players');
        this.statUnique = document.getElementById('stat-unique');
        this.statTotal = document.getElementById('stat-total');
        this.refreshBtn = document.getElementById('refresh-btn');
        this.exportBtn = document.getElementById('export-btn');
        this.clearBtn = document.getElementById('clear-btn');
        this.loadingOverlay = document.getElementById('loading-overlay');
        this.expandPackagesCheckbox = document.getElementById('expand-packages');

        // Event listeners
        this.searchBtn.addEventListener('click', () => this.searchPlayer());
        this.playerSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.searchPlayer();
        });
        this.groupBySelect.addEventListener('change', () => { this.render(); this.updateUrl(); });
        this.filterTierSelect.addEventListener('change', () => { this.render(); this.updateUrl(); });
        this.filterRaritySelect.addEventListener('change', () => { this.render(); this.updateUrl(); });
        this.filterTagSelect.addEventListener('change', () => { this.render(); this.updateUrl(); });
        this.sortBySelect.addEventListener('change', () => { this.render(); this.updateUrl(); });
        this.sortOrderSelect.addEventListener('change', () => { this.render(); this.updateUrl(); });
        this.itemSearchInput.addEventListener('input', () => { this.render(); this.updateUrl(); });
        this.expandPackagesCheckbox.addEventListener('change', () => {
            this.expandPackages = this.expandPackagesCheckbox.checked;
            this.render();
            this.updateUrl();
        });
        this.refreshBtn.addEventListener('click', () => this.refreshAll());
        this.exportBtn.addEventListener('click', () => this.exportCSV());
        this.clearBtn.addEventListener('click', () => this.clearAll());

        this.render();

        // Load item database first, then check for URL parameters
        await this.loadItemDatabase();
        this.loadPlayersFromUrl();
    }

    // Load the item database from bitjita.com
    async loadItemDatabase() {
        try {
            const response = await fetch(`${API_BASE}/items/__data.json`);
            const json = await response.json();
            const decoded = this.decodeSvelteKitData(json);

            if (decoded && decoded.items && Array.isArray(decoded.items)) {
                for (const item of decoded.items) {
                    if (item && item.id) {
                        this.itemDatabase.set(String(item.id), {
                            name: item.name || item.itemName,
                            tier: item.tier,
                            rarity: item.rarityStr || item.rarity,
                            tag: item.tag
                        });
                    }
                }
                console.log(`Loaded ${this.itemDatabase.size} items into database`);
            }
            this.itemDatabaseLoaded = true;
        } catch (error) {
            console.error('Error loading item database:', error);
            this.itemDatabaseLoaded = false;
        }
    }

    // Load settings from URL parameters
    loadSettingsFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);

        // Load filter/sort settings
        const groupBy = urlParams.get('groupBy');
        const filterTier = urlParams.get('tier');
        const filterRarity = urlParams.get('rarity');
        const filterTag = urlParams.get('type');
        const sortBy = urlParams.get('sortBy');
        const sortOrder = urlParams.get('order');
        const search = urlParams.get('search');
        const expandPkg = urlParams.get('expand');

        // Apply settings to dropdowns
        if (groupBy && this.groupBySelect.querySelector(`option[value="${groupBy}"]`)) {
            this.groupBySelect.value = groupBy;
        }
        if (filterTier && this.filterTierSelect.querySelector(`option[value="${filterTier}"]`)) {
            this.filterTierSelect.value = filterTier;
        }
        if (filterRarity && this.filterRaritySelect.querySelector(`option[value="${filterRarity}"]`)) {
            this.filterRaritySelect.value = filterRarity;
        }
        if (sortBy && this.sortBySelect.querySelector(`option[value="${sortBy}"]`)) {
            this.sortBySelect.value = sortBy;
        }
        if (sortOrder && this.sortOrderSelect.querySelector(`option[value="${sortOrder}"]`)) {
            this.sortOrderSelect.value = sortOrder;
        }
        if (search) {
            this.itemSearchInput.value = search;
        }

        // Apply expand packages setting (default is true/checked)
        if (expandPkg !== null) {
            this.expandPackages = expandPkg !== '0';
            this.expandPackagesCheckbox.checked = this.expandPackages;
        }

        // Store tag filter to apply after items load (tag options are dynamic)
        this.pendingTagFilter = filterTag;
    }

    // Load players from URL parameter (e.g., ?players=123,456,789)
    async loadPlayersFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const playersParam = urlParams.get('players');

        // Load settings first
        this.loadSettingsFromUrl();

        if (!playersParam) {
            // Still render to apply any filter/sort settings even without players
            this.render();
            return;
        }

        const entityIds = playersParam.split(',').map(id => id.trim()).filter(id => id);

        if (entityIds.length === 0) {
            this.render();
            return;
        }

        this.showLoading();

        for (const entityId of entityIds) {
            try {
                // First fetch player info to get username
                const response = await fetch(
                    `${API_BASE}/players/${entityId}/__data.json?x-sveltekit-invalidated=01`
                );
                const json = await response.json();
                const decoded = this.decodeSvelteKitData(json);

                if (decoded && decoded.player) {
                    const username = decoded.player.username || `Player ${entityId}`;
                    const items = await this.fetchPlayerInventory(entityId);
                    this.players.set(entityId, { username, items });
                }
            } catch (error) {
                console.error(`Error loading player ${entityId}:`, error);
            }
        }

        // Apply pending tag filter now that items are loaded
        if (this.pendingTagFilter) {
            // Tag options will be populated by render(), so we set it after
            this.render();
            if (this.filterTagSelect.querySelector(`option[value="${this.pendingTagFilter}"]`)) {
                this.filterTagSelect.value = this.pendingTagFilter;
            }
            this.pendingTagFilter = null;
            this.render(); // Re-render with tag filter applied
        } else {
            this.render();
        }

        this.hideLoading();
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

        // Find the data node (skip null entries)
        const dataNode = json.nodes.find(n => n && n.type === 'data' && n.data);
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
            this.updateUrl();
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
                    // After devalue hydration, pocket structure can be:
                    // Option A: { locked, volume, contents: { itemId, quantity, ... } }
                    // Option B: { locked, volume, quantity, contents/item_id: entityId }

                    let quantity;
                    let itemEntityId;
                    let itemDetails = null;

                    const contents = pocket.contents;

                    if (contents && typeof contents === 'object') {
                        // Option A: contents is an object with quantity and itemId
                        quantity = contents.quantity;
                        itemEntityId = contents.itemId || contents.item_id;

                        // The itemId might be a number that references the items/cargos lookup
                        // OR the contents object itself might have item details
                        if (contents.name || contents.itemName) {
                            itemDetails = contents;
                        }
                    } else {
                        // Option B: quantity is on pocket, contents is the entity ID
                        quantity = pocket.quantity;
                        itemEntityId = contents || pocket.item_id;
                    }

                    // Handle quantity - must be a positive number
                    if (typeof quantity !== 'number') {
                        if (typeof quantity === 'string' && /^\d+$/.test(quantity)) {
                            quantity = parseInt(quantity);
                        } else {
                            continue;
                        }
                    }

                    if (quantity < 1) continue;

                    // If we don't have item details yet, look them up in various places
                    if (!itemDetails && itemEntityId) {
                        // First try the player data's items/cargos lookup
                        itemDetails = itemsLookup[itemEntityId] || cargosLookup[itemEntityId] ||
                                      itemsLookup[String(itemEntityId)] || cargosLookup[String(itemEntityId)];

                        // If not found, try the global item database
                        if (!itemDetails || (!itemDetails.name && !itemDetails.itemName)) {
                            const dbItem = this.itemDatabase.get(String(itemEntityId));
                            if (dbItem) {
                                itemDetails = dbItem;
                            }
                        }
                    }

                    if (itemDetails && (itemDetails.name || itemDetails.itemName)) {
                        this.extractItemFromDetails(itemDetails, quantity, items, entityId, locationName);
                    }
                }
            }
        }

        return items;
    }

    extractItemFromDetails(itemDetails, quantity, items, playerId, location) {
        if (!itemDetails) return;

        // Item name could be in 'name' or 'itemName' field
        const name = itemDetails.name || itemDetails.itemName;
        const rarity = itemDetails.rarityStr || itemDetails.rarity;

        if (name && typeof name === 'string') {
            // Filter out non-inventory items (skills, badges, cosmetics, etc.)
            if (this.shouldSkipItem(name)) {
                return;
            }

            // Try to get tier from itemDetails first, fall back to name derivation
            let tier = this.normalizeTier(itemDetails.tier);

            // If normalizeTier returns null (invalid/missing data), derive from name
            if (tier === null) {
                tier = this.deriveTierFromName(name);
            }

            // Get base item name by stripping tier prefix
            const baseItem = this.getBaseItemName(name);

            // Get tag/type from item details
            const tag = itemDetails.tag || 'Other';

            items.push({
                name: name,
                tier: tier,
                rarity: this.normalizeRarity(rarity),
                count: quantity,
                playerId,
                location,
                baseItem,
                tag
            });
        }
    }

    // Strip tier prefix from item name to get base item
    getBaseItemName(name) {
        const tierPrefixes = [
            'Rough', 'Primitive', 'Basic', 'Simple', 'Improved', 'Sturdy',
            'Quality', 'Infused', 'Fine', 'Essential', 'Superior', 'Exquisite',
            'Succulent', 'Peerless', 'Ornate', 'Ambrosial', 'Flavorful',
            'Aurumite', 'Pristine', 'Celestium', 'Luminite', 'Rathium',
            'Zesty', 'Plain', 'Novice'
        ];

        for (const prefix of tierPrefixes) {
            if (name.startsWith(prefix + ' ')) {
                return name.substring(prefix.length + 1);
            }
        }
        return name;
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
        // Handle null/undefined - these are items without tier info
        if (tier === undefined || tier === null) {
            return null; // Return null to indicate no tier data
        }

        // Handle boolean (bad data)
        if (typeof tier === 'boolean') {
            return null;
        }

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
            return match ? parseInt(match[0]) : null;
        }

        // Handle number - but some are clearly wrong (like 19998, 6922186)
        // Valid tiers are -1 to 8
        if (typeof tier === 'number') {
            if (tier >= -1 && tier <= 8) {
                return tier;
            }
            // Invalid tier number
            return null;
        }

        return null;
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
        this.updateUrl();
        this.render();
    }

    // Update URL with current player IDs and all filter/sort settings
    updateUrl() {
        const entityIds = Array.from(this.players.keys());
        const url = new URL(window.location);

        // Players
        if (entityIds.length > 0) {
            url.searchParams.set('players', entityIds.join(','));
        } else {
            url.searchParams.delete('players');
        }

        // Group By
        const groupBy = this.groupBySelect.value;
        if (groupBy !== 'none') {
            url.searchParams.set('groupBy', groupBy);
        } else {
            url.searchParams.delete('groupBy');
        }

        // Filter Tier
        const filterTier = this.filterTierSelect.value;
        if (filterTier !== 'all') {
            url.searchParams.set('tier', filterTier);
        } else {
            url.searchParams.delete('tier');
        }

        // Filter Rarity
        const filterRarity = this.filterRaritySelect.value;
        if (filterRarity !== 'all') {
            url.searchParams.set('rarity', filterRarity);
        } else {
            url.searchParams.delete('rarity');
        }

        // Filter Tag/Type
        const filterTag = this.filterTagSelect.value;
        if (filterTag !== 'all') {
            url.searchParams.set('type', filterTag);
        } else {
            url.searchParams.delete('type');
        }

        // Sort By
        const sortBy = this.sortBySelect.value;
        if (sortBy !== 'name') {
            url.searchParams.set('sortBy', sortBy);
        } else {
            url.searchParams.delete('sortBy');
        }

        // Sort Order
        const sortOrder = this.sortOrderSelect.value;
        if (sortOrder !== 'asc') {
            url.searchParams.set('order', sortOrder);
        } else {
            url.searchParams.delete('order');
        }

        // Search
        const search = this.itemSearchInput.value.trim();
        if (search) {
            url.searchParams.set('search', search);
        } else {
            url.searchParams.delete('search');
        }

        // Expand Packages (default is true, so only save when false)
        if (!this.expandPackages) {
            url.searchParams.set('expand', '0');
        } else {
            url.searchParams.delete('expand');
        }

        window.history.replaceState({}, '', url);
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

    // Check if item is a package and return info about its contents
    // Returns { isPackage: true, baseItemName, quantityPer } or { isPackage: false }
    getPackageInfo(itemName) {
        if (!itemName.endsWith(' Package')) {
            return { isPackage: false };
        }

        // Find which package type this matches
        for (const [packageSuffix, quantity] of Object.entries(PACKAGE_CONTENTS)) {
            if (itemName.endsWith(packageSuffix)) {
                // Extract the base item name by removing " Package" from the end
                const baseItemName = itemName.slice(0, -8); // Remove " Package"
                return {
                    isPackage: true,
                    baseItemName,
                    quantityPer: quantity
                };
            }
        }

        return { isPackage: false };
    }

    getAllItems() {
        const allItems = [];
        const packageContents = []; // Track expanded package contents separately

        // First pass: collect all items and build a tag lookup for base items
        const baseItemTags = new Map(); // baseItemName -> tag

        for (const [entityId, playerData] of this.players) {
            for (const item of playerData.items) {
                allItems.push({
                    ...item,
                    playerName: playerData.username
                });

                // Track tags for base items (non-packages) so we can use them for expanded contents
                if (!item.name.endsWith(' Package') && item.tag) {
                    baseItemTags.set(item.name, item.tag);
                }
            }
        }

        // Second pass: expand packages if enabled
        if (this.expandPackages) {
            for (const [entityId, playerData] of this.players) {
                for (const item of playerData.items) {
                    const pkgInfo = this.getPackageInfo(item.name);
                    if (pkgInfo.isPackage) {
                        // Look up the tag for the base item from our collected items
                        // or fall back to a reasonable default based on common patterns
                        const baseItemTag = baseItemTags.get(pkgInfo.baseItemName) ||
                                           this.inferTagForBaseItem(pkgInfo.baseItemName) ||
                                           item.tag;

                        packageContents.push({
                            name: pkgInfo.baseItemName,
                            tier: item.tier,
                            rarity: item.rarity,
                            count: item.count * pkgInfo.quantityPer,
                            playerId: item.playerId,
                            location: item.location,
                            baseItem: this.getBaseItemName(pkgInfo.baseItemName),
                            tag: baseItemTag,
                            playerName: playerData.username,
                            fromPackage: true // Mark as coming from a package
                        });
                    }
                }
            }
        }

        // Add package contents to the items list
        return [...allItems, ...packageContents];
    }

    // Infer the tag/type for a base item based on its name
    inferTagForBaseItem(itemName) {
        const baseItemName = this.getBaseItemName(itemName).toLowerCase();

        // Map common base items to their tags
        const tagMappings = {
            'filet': 'Food',
            'brick': 'Construction',
            'clay lump': 'Construction',
            'plank': 'Construction',
            'cloth': 'Textile',
            'pebbles': 'Construction',
            'raw meat': 'Food',
            'bark': 'Forestry',
            'tannin': 'Leather',
            'ingot': 'Smithing',
            'fiber': 'Textile',
            'leather': 'Leather',
            'raw pelt': 'Leather',
            'fish oil': 'Food',
            'flower': 'Farming',
            'pitch': 'Forestry',
            'rope': 'Textile',
            'vial': 'Alchemy',
            'parchment': 'Scribing',
            'pigment': 'Scribing',
            'ink': 'Scribing',
            'stone carving': 'Construction'
        };

        for (const [key, tag] of Object.entries(tagMappings)) {
            if (baseItemName.includes(key)) {
                return tag;
            }
        }

        return null;
    }

    getFilteredItems() {
        let items = this.getAllItems();

        // If expand packages is enabled, hide the packages themselves (their contents are already added)
        if (this.expandPackages) {
            items = items.filter(i => !i.name.endsWith(' Package'));
        }

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

        // Filter by tag/type
        const tagFilter = this.filterTagSelect.value;
        if (tagFilter !== 'all') {
            items = items.filter(i => i.tag === tagFilter);
        }

        // Filter by search term
        const search = this.itemSearchInput.value.toLowerCase().trim();
        if (search) {
            items = items.filter(i => i.name.toLowerCase().includes(search));
        }

        return items;
    }

    aggregateItems(items) {
        // Aggregate same items (combine counts) and track contributing players with quantities
        const aggregated = new Map();

        for (const item of items) {
            // Key by name + tier + rarity (and player if grouping by player)
            const groupBy = this.groupBySelect.value;
            const key = groupBy === 'player'
                ? `${item.name}|${item.tier}|${item.rarity}|${item.playerName}`
                : `${item.name}|${item.tier}|${item.rarity}`;

            if (aggregated.has(key)) {
                const existing = aggregated.get(key);
                existing.count += item.count;
                // Track all contributing players with their quantities
                if (item.playerName) {
                    const currentQty = existing.playerQuantities.get(item.playerName) || 0;
                    existing.playerQuantities.set(item.playerName, currentQty + item.count);
                }
            } else {
                // Initialize with a Map of contributing players and their quantities
                const newItem = { ...item, playerQuantities: new Map() };
                if (item.playerName) {
                    newItem.playerQuantities.set(item.playerName, item.count);
                }
                aggregated.set(key, newItem);
            }
        }

        return Array.from(aggregated.values());
    }

    render() {
        this.renderPlayerList();
        this.updateTagFilter();
        this.renderInventory();
        this.updateStats();
    }

    // Populate the tag filter dropdown with tags from current inventory
    updateTagFilter() {
        const allItems = this.getAllItems();
        const tags = new Set();

        for (const item of allItems) {
            if (item.tag) {
                tags.add(item.tag);
            }
        }

        // Sort tags alphabetically
        const sortedTags = Array.from(tags).sort((a, b) => a.localeCompare(b));

        // Keep current selection if still valid
        const currentValue = this.filterTagSelect.value;

        // Rebuild dropdown
        this.filterTagSelect.innerHTML = '<option value="all">All Types</option>' +
            sortedTags.map(tag => `<option value="${this.escapeHtml(tag)}">${this.escapeHtml(tag)}</option>`).join('');

        // Restore selection if still valid
        if (tags.has(currentValue)) {
            this.filterTagSelect.value = currentValue;
        }
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
            this.inventoryContent.innerHTML = this.renderItemTable(aggregated);
        } else {
            this.renderGroupedItems(aggregated, groupBy);
        }
    }

    renderItemTable(items, showPlayer = true) {
        // Sort items based on sort dropdown
        const sortBy = this.sortBySelect.value;
        const sortOrder = this.sortOrderSelect.value;
        const groupBy = this.groupBySelect.value;

        // Rarity order for sorting
        const rarityOrder = { 'Common': 1, 'Uncommon': 2, 'Rare': 3, 'Epic': 4, 'Legendary': 5, 'Mythic': 6 };

        items.sort((a, b) => {
            let comparison = 0;

            if (sortBy === 'name') {
                comparison = a.name.localeCompare(b.name);
            } else if (sortBy === 'tier') {
                comparison = a.tier - b.tier;
                if (comparison === 0) comparison = a.name.localeCompare(b.name);
            } else if (sortBy === 'rarity') {
                comparison = (rarityOrder[a.rarity] || 0) - (rarityOrder[b.rarity] || 0);
                if (comparison === 0) comparison = a.name.localeCompare(b.name);
            } else if (sortBy === 'count') {
                comparison = a.count - b.count;
                if (comparison === 0) comparison = a.name.localeCompare(b.name);
            }

            // For baseItem grouping, always sort by tier within groups
            if (groupBy === 'baseItem' && sortBy === 'name') {
                comparison = a.tier - b.tier || a.name.localeCompare(b.name);
            }

            return sortOrder === 'desc' ? -comparison : comparison;
        });

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
                        <tr class="rarity-row-${(item.rarity || 'common').toLowerCase()}">
                            <td class="item-name">${this.escapeHtml(item.name)}</td>
                            <td><span class="tier-badge">T${item.tier}</span></td>
                            <td><span class="rarity-${(item.rarity || 'common').toLowerCase()}">${item.rarity || 'Unknown'}</span></td>
                            <td class="count-value">${item.count.toLocaleString()}</td>
                            ${showPlayerColumn ? `<td class="player-tags">${this.renderPlayerTags(item.playerQuantities)}</td>` : ''}
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
            } else if (groupBy === 'baseItem') {
                key = item.baseItem || item.name;
            } else if (groupBy === 'tag') {
                key = item.tag || 'Other';
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
        } else if (groupBy === 'baseItem') {
            // Sort by base item name alphabetically
            sortedGroups.sort((a, b) => a[0].localeCompare(b[0]));
        } else if (groupBy === 'tag') {
            // Sort by tag name alphabetically
            sortedGroups.sort((a, b) => a[0].localeCompare(b[0]));
        } else {
            sortedGroups.sort((a, b) => a[0].localeCompare(b[0]));
        }

        this.inventoryContent.innerHTML = sortedGroups.map(([groupName, groupItems], index) => {
            const totalCount = groupItems.reduce((sum, i) => sum + i.count, 0);
            const groupId = `group-${groupBy}-${index}`;
            return `
                <div class="inventory-group" data-group-id="${groupId}">
                    <div class="group-header ${groupBy === 'rarity' ? 'rarity-' + groupName.toLowerCase() : ''}" onclick="viewer.toggleGroup('${groupId}')">
                        <div class="group-header-content">
                            <span class="group-chevron">▼</span>
                            <span class="group-name">${this.escapeHtml(groupName)}</span>
                        </div>
                        <span class="group-count">${groupItems.length} items (${totalCount.toLocaleString()} total)</span>
                    </div>
                    <div class="group-content" id="${groupId}">
                        ${this.renderItemTable(groupItems, groupBy !== 'player')}
                    </div>
                </div>
            `;
        }).join('');
    }

    toggleGroup(groupId) {
        const groupContent = document.getElementById(groupId);
        const groupElement = document.querySelector(`[data-group-id="${groupId}"]`);
        const chevron = groupElement.querySelector('.group-chevron');

        if (groupContent.classList.contains('collapsed')) {
            groupContent.classList.remove('collapsed');
            chevron.style.transform = 'rotate(0deg)';
        } else {
            groupContent.classList.add('collapsed');
            chevron.style.transform = 'rotate(-90deg)';
        }
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
            this.updateUrl();
            this.render();
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Render player tags for items with multiple contributors
    renderPlayerTags(playerQuantities) {
        if (!playerQuantities || playerQuantities.size === 0) {
            return '';
        }

        // Convert Map to sorted array of [player, quantity] entries
        const playerList = Array.from(playerQuantities.entries())
            .sort((a, b) => a[0].localeCompare(b[0]));

        // Show quantity in parentheses only if there are 2 or more players
        const showQuantities = playerQuantities.size >= 2;

        return playerList.map(([player, quantity]) =>
            showQuantities
                ? `<span class="player-tag">${this.escapeHtml(player)} (${quantity.toLocaleString()})</span>`
                : `<span class="player-tag">${this.escapeHtml(player)}</span>`
        ).join('');
    }
}

// Market Viewer Class
class MarketViewer {
    constructor() {
        this.items = [];
        this.selectedTags = new Set();
        this.selectedRarity = 'all';
        this.sortBy = 'name';
        this.sortOrder = 'asc';
        this.searchTerm = '';
    }

    async fetchMarketData() {
        try {
            const response = await fetch(`${API_BASE}/market/__data.json?hasOrders=true&hasSellOrders=true`);
            const json = await response.json();

            // Use the same devalue decoder as InventoryViewer
            const decoded = viewer.decodeSvelteKitData(json);

            // Extract items from the decoded data structure
            this.items = this.extractMarketItems(decoded);
            return this.items;
        } catch (error) {
            console.error('Error fetching market data:', error);
            throw error;
        }
    }

    extractMarketItems(data) {
        // Market data structure: the decoded data is the items array itself or has items property
        const items = [];

        // Try to get the items array from different possible locations
        let itemsArray = null;

        if (Array.isArray(data)) {
            itemsArray = data;
        } else if (data && data.items && Array.isArray(data.items)) {
            itemsArray = data.items;
        }

        if (itemsArray) {
            for (const item of itemsArray) {
                if (item && typeof item === 'object' && item.name) {
                    items.push({
                        id: item.id || '',
                        name: item.name || 'Unknown',
                        tier: item.tier ?? 0,
                        rarity: item.rarityStr || item.rarity || 'Common',
                        tag: item.tag || 'Unknown',
                        hasSellOrders: item.hasSellOrders || false,
                        hasBuyOrders: item.hasBuyOrders || false,
                        sellOrders: item.sellOrders || 0,
                        buyOrders: item.buyOrders || 0,
                        totalOrders: item.totalOrders || 0,
                        volume: item.volume || 0,
                        description: item.description || ''
                    });
                }
            }
        }

        console.log(`Extracted ${items.length} market items`);
        return items;
    }

    getAvailableTags() {
        const tags = new Set();
        this.items.forEach(item => {
            if (item.tag && item.tag !== 'Unknown') {
                tags.add(item.tag);
            }
        });
        return Array.from(tags).sort();
    }

    getFilteredItems() {
        let filtered = [...this.items];

        // Filter by selected tags (multi-select)
        if (this.selectedTags.size > 0) {
            filtered = filtered.filter(item => this.selectedTags.has(item.tag));
        }

        // Filter by rarity
        if (this.selectedRarity !== 'all') {
            filtered = filtered.filter(item => item.rarity === this.selectedRarity);
        }

        // Filter by search term
        if (this.searchTerm) {
            const search = this.searchTerm.toLowerCase();
            filtered = filtered.filter(item => item.name.toLowerCase().includes(search));
        }

        // Sort items
        filtered.sort((a, b) => {
            let comparison = 0;

            if (this.sortBy === 'name') {
                comparison = a.name.localeCompare(b.name);
            } else if (this.sortBy === 'tier') {
                comparison = a.tier - b.tier;
            } else if (this.sortBy === 'rarity') {
                const rarityOrder = { 'Common': 1, 'Uncommon': 2, 'Rare': 3, 'Epic': 4, 'Legendary': 5, 'Mythic': 6 };
                comparison = (rarityOrder[a.rarity] || 0) - (rarityOrder[b.rarity] || 0);
            } else if (this.sortBy === 'sellOrders') {
                comparison = a.sellOrders - b.sellOrders;
            } else if (this.sortBy === 'buyOrders') {
                comparison = a.buyOrders - b.buyOrders;
            }

            return this.sortOrder === 'desc' ? -comparison : comparison;
        });

        return filtered;
    }
}

// Initialize
const viewer = new InventoryViewer();
const marketViewer = new MarketViewer();

// View Navigation Setup
function setupNavigation() {
    const navTabs = document.querySelectorAll('.nav-tab');

    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const view = tab.dataset.view;
            switchView(view);
        });
    });

    // Load view from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    if (viewParam && (viewParam === 'inventory' || viewParam === 'market')) {
        switchView(viewParam);
    }
}

async function switchView(view) {
    currentView = view;

    // Update active tab
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.view === view);
    });

    // Update URL without reload
    const url = new URL(window.location);
    url.searchParams.set('view', view);
    window.history.pushState({}, '', url);

    // Show/hide appropriate sections
    const inventorySections = document.querySelectorAll('.player-search, .active-players, .view-controls');
    const footer = document.querySelector('footer');
    const main = document.querySelector('main');

    if (view === 'inventory') {
        inventorySections.forEach(section => section.style.display = '');
        footer.style.display = 'flex';
        // Existing inventory functionality
    } else if (view === 'market') {
        inventorySections.forEach(section => section.style.display = 'none');
        footer.style.display = 'none';
        await renderMarketView();
    }
}

async function renderMarketView() {
    const main = document.querySelector('main');

    // Show loading
    document.getElementById('loading-overlay').classList.remove('hidden');

    try {
        // Fetch market data if not already loaded
        if (marketViewer.items.length === 0) {
            await marketViewer.fetchMarketData();
        }

        const tags = marketViewer.getAvailableTags();

        // Build market view HTML
        main.innerHTML = `
            <section class="market-filters">
                <h2>Market Filters</h2>
                <div class="controls-row">
                    <div class="control-group">
                        <label>Tags/Types (Multi-select):</label>
                        <div id="tag-filter-container" class="tag-filter-container"></div>
                    </div>
                    <div class="control-group">
                        <label>Rarity:</label>
                        <select id="market-rarity-filter">
                            <option value="all">All Rarities</option>
                            <option value="Common">Common</option>
                            <option value="Uncommon">Uncommon</option>
                            <option value="Rare">Rare</option>
                            <option value="Epic">Epic</option>
                            <option value="Legendary">Legendary</option>
                            <option value="Mythic">Mythic</option>
                        </select>
                    </div>
                    <div class="control-group">
                        <label>Sort By:</label>
                        <select id="market-sort-by">
                            <option value="name">Name</option>
                            <option value="tier">Tier</option>
                            <option value="rarity">Rarity</option>
                            <option value="sellOrders">Sell Orders</option>
                            <option value="buyOrders">Buy Orders</option>
                        </select>
                    </div>
                    <div class="control-group">
                        <label>Order:</label>
                        <select id="market-sort-order">
                            <option value="asc">Ascending</option>
                            <option value="desc">Descending</option>
                        </select>
                    </div>
                    <div class="control-group">
                        <label>Search:</label>
                        <input type="text" id="market-search" placeholder="Search items...">
                    </div>
                </div>
            </section>

            <section class="stats-bar">
                <div class="stat">
                    <span class="stat-value" id="market-stat-total">0</span>
                    <span class="stat-label">Total Items</span>
                </div>
                <div class="stat">
                    <span class="stat-value" id="market-stat-filtered">0</span>
                    <span class="stat-label">Filtered Items</span>
                </div>
                <div class="stat">
                    <span class="stat-value" id="market-stat-sell">0</span>
                    <span class="stat-label">With Sell Orders</span>
                </div>
                <div class="stat">
                    <span class="stat-value" id="market-stat-buy">0</span>
                    <span class="stat-label">With Buy Orders</span>
                </div>
            </section>

            <section class="inventory-display">
                <div id="market-content"></div>
            </section>
        `;

        // Render tag filter checkboxes
        renderTagFilters(tags);

        // Setup event listeners
        setupMarketEventListeners();

        // Initial render
        renderMarketTable();

    } catch (error) {
        main.innerHTML = `<section><p class="error-message">Error loading market data: ${error.message}</p></section>`;
    } finally {
        document.getElementById('loading-overlay').classList.add('hidden');
    }
}

function renderTagFilters(tags) {
    const container = document.getElementById('tag-filter-container');
    container.innerHTML = tags.map(tag => `
        <label class="tag-filter-item">
            <input type="checkbox" value="${tag}" class="tag-checkbox">
            <span>${tag}</span>
        </label>
    `).join('');
}

function setupMarketEventListeners() {
    // Tag checkboxes
    document.querySelectorAll('.tag-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                marketViewer.selectedTags.add(e.target.value);
            } else {
                marketViewer.selectedTags.delete(e.target.value);
            }
            renderMarketTable();
        });
    });

    // Rarity filter
    document.getElementById('market-rarity-filter').addEventListener('change', (e) => {
        marketViewer.selectedRarity = e.target.value;
        renderMarketTable();
    });

    // Sort controls
    document.getElementById('market-sort-by').addEventListener('change', (e) => {
        marketViewer.sortBy = e.target.value;
        renderMarketTable();
    });

    document.getElementById('market-sort-order').addEventListener('change', (e) => {
        marketViewer.sortOrder = e.target.value;
        renderMarketTable();
    });

    // Search
    document.getElementById('market-search').addEventListener('input', (e) => {
        marketViewer.searchTerm = e.target.value;
        renderMarketTable();
    });
}

function renderMarketTable() {
    const items = marketViewer.getFilteredItems();
    const content = document.getElementById('market-content');

    // Update stats
    document.getElementById('market-stat-total').textContent = marketViewer.items.length.toLocaleString();
    document.getElementById('market-stat-filtered').textContent = items.length.toLocaleString();
    document.getElementById('market-stat-sell').textContent = items.filter(i => i.hasSellOrders).length.toLocaleString();
    document.getElementById('market-stat-buy').textContent = items.filter(i => i.hasBuyOrders).length.toLocaleString();

    if (items.length === 0) {
        content.innerHTML = '<p class="empty-state">No items match your filters.</p>';
        return;
    }

    content.innerHTML = `
        <table class="inventory-table">
            <thead>
                <tr>
                    <th>Item</th>
                    <th>Tier</th>
                    <th>Rarity</th>
                    <th>Tag/Type</th>
                    <th>Sell Orders</th>
                    <th>Buy Orders</th>
                </tr>
            </thead>
            <tbody>
                ${items.map(item => `
                    <tr class="rarity-row-${item.rarity.toLowerCase()}">
                        <td class="item-name">${escapeHtml(item.name)}</td>
                        <td><span class="tier-badge">T${item.tier}</span></td>
                        <td><span class="rarity-${item.rarity.toLowerCase()}">${item.rarity}</span></td>
                        <td>${escapeHtml(item.tag)}</td>
                        <td class="count-value">${item.sellOrders}</td>
                        <td class="count-value">${item.buyOrders}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize navigation
setupNavigation();
