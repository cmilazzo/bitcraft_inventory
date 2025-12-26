// Bitcraft Inventory Viewer
// Fetches data from bitjita.com API and displays aggregated inventory

const API_BASE = 'https://bcproxy.bitcraft-data.com/proxy';
const VERSION = '1.0016';

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
        this.setupDomElements();
        this.setupEventListeners();
        this.render();

        // Load item database first, then check for URL parameters
        await this.loadItemDatabase();
        this.loadPlayersFromUrl();
    }

    setupDomElements() {
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
    }

    setupEventListeners() {
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

    // Load settings from URL parameters (inventory-specific)
    loadSettingsFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);

        // Load filter/sort settings (inventory-specific parameters)
        const groupBy = urlParams.get('inv_group');
        const filterTier = urlParams.get('inv_tier');
        const filterRarity = urlParams.get('inv_rarity');
        const filterTag = urlParams.get('inv_type');
        const sortBy = urlParams.get('inv_sort');
        const sortOrder = urlParams.get('inv_order');
        const search = urlParams.get('inv_search');
        const expandPkg = urlParams.get('inv_expand');

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

            // If we're in player-market view, load that player's market data
            if (currentView === 'player-market') {
                await loadPlayerMarketData(entityId);
            } else {
                this.render();
            }
        } catch (error) {
            console.error('Error fetching inventory:', error);
            alert(`Error loading inventory for ${username}.`);
        }

        this.hideLoading();
    }

    async fetchPlayerInventory(entityId) {
        const response = await fetch(
            `${API_BASE}/players/${entityId}/inventory/__data.json?x-sveltekit-invalidated=001`
        );
        const json = await response.json();
        const decoded = this.decodeSvelteKitData(json);

        if (!decoded) {
            throw new Error('Failed to decode player data');
        }

        const items = [];

        // Structure: decoded = { inventories: [...containers], items: {...}, cargos: {...} }
        if (decoded && decoded.inventories) {
            const containers = Array.isArray(decoded.inventories) ? decoded.inventories : [];
            const itemsLookup = decoded.items || {};
            const cargosLookup = decoded.cargos || {};

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

    // Update URL with current player IDs and all filter/sort settings (inventory-specific)
    updateUrl() {
        const entityIds = Array.from(this.players.keys());
        const url = new URL(window.location);

        // Players (shared parameter, not view-specific)
        if (entityIds.length > 0) {
            url.searchParams.set('players', entityIds.join(','));
        } else {
            url.searchParams.delete('players');
        }

        // Group By (inventory-specific parameter)
        const groupBy = this.groupBySelect.value;
        if (groupBy !== 'none') {
            url.searchParams.set('inv_group', groupBy);
        } else {
            url.searchParams.delete('inv_group');
        }

        // Filter Tier (inventory-specific parameter)
        const filterTier = this.filterTierSelect.value;
        if (filterTier !== 'all') {
            url.searchParams.set('inv_tier', filterTier);
        } else {
            url.searchParams.delete('inv_tier');
        }

        // Filter Rarity (inventory-specific parameter)
        const filterRarity = this.filterRaritySelect.value;
        if (filterRarity !== 'all') {
            url.searchParams.set('inv_rarity', filterRarity);
        } else {
            url.searchParams.delete('inv_rarity');
        }

        // Filter Tag/Type (inventory-specific parameter)
        const filterTag = this.filterTagSelect.value;
        if (filterTag !== 'all') {
            url.searchParams.set('inv_type', filterTag);
        } else {
            url.searchParams.delete('inv_type');
        }

        // Sort By (inventory-specific parameter)
        const sortBy = this.sortBySelect.value;
        if (sortBy !== 'name') {
            url.searchParams.set('inv_sort', sortBy);
        } else {
            url.searchParams.delete('inv_sort');
        }

        // Sort Order (inventory-specific parameter)
        const sortOrder = this.sortOrderSelect.value;
        if (sortOrder !== 'asc') {
            url.searchParams.set('inv_order', sortOrder);
        } else {
            url.searchParams.delete('inv_order');
        }

        // Search (inventory-specific parameter)
        const search = this.itemSearchInput.value.trim();
        if (search) {
            url.searchParams.set('inv_search', search);
        } else {
            url.searchParams.delete('inv_search');
        }

        // Expand Packages (inventory-specific parameter, default is true, so only save when false)
        if (!this.expandPackages) {
            url.searchParams.set('inv_expand', '0');
        } else {
            url.searchParams.delete('inv_expand');
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

        const isPlayerMarketView = currentView === 'player-market';
        const selectedPlayerId = playerMarketViewer.selectedPlayer?.id;

        this.playerList.innerHTML = Array.from(this.players.entries()).map(([entityId, data]) => {
            const isSelected = isPlayerMarketView && selectedPlayerId === entityId;
            return `
                <div class="player-chip ${isSelected ? 'selected' : ''}"
                     ${isPlayerMarketView ? `style="cursor: pointer;" onclick="loadPlayerMarketData('${entityId}')"` : ''}>
                    <span>${this.escapeHtml(data.username)}</span>
                    <span>(${data.items.length} items)</span>
                    <button class="remove-btn" onclick="event.stopPropagation(); viewer.removePlayer('${entityId}')">&times;</button>
                </div>
            `;
        }).join('');
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
        this.loadFromUrl();
    }

    loadFromUrl() {
        const params = new URLSearchParams(window.location.search);

        // Load selected tags (market-specific parameter)
        const tags = params.get('mkt_tags');
        if (tags) {
            tags.split(',').forEach(tag => this.selectedTags.add(tag));
        }

        // Load rarity filter (market-specific parameter)
        const rarity = params.get('mkt_rarity');
        if (rarity) {
            this.selectedRarity = rarity;
        }

        // Load sort settings (market-specific parameters)
        const sortBy = params.get('mkt_sort');
        if (sortBy) {
            this.sortBy = sortBy;
        }

        const sortOrder = params.get('mkt_order');
        if (sortOrder) {
            this.sortOrder = sortOrder;
        }

        // Load search term (market-specific parameter)
        const search = params.get('mkt_search');
        if (search) {
            this.searchTerm = search;
        }
    }

    updateUrl() {
        const params = new URLSearchParams(window.location.search);

        // Update tags (market-specific parameter)
        if (this.selectedTags.size > 0) {
            params.set('mkt_tags', Array.from(this.selectedTags).join(','));
        } else {
            params.delete('mkt_tags');
        }

        // Update rarity (market-specific parameter)
        if (this.selectedRarity !== 'all') {
            params.set('mkt_rarity', this.selectedRarity);
        } else {
            params.delete('mkt_rarity');
        }

        // Update sort (market-specific parameters)
        if (this.sortBy !== 'name') {
            params.set('mkt_sort', this.sortBy);
        } else {
            params.delete('mkt_sort');
        }

        if (this.sortOrder !== 'asc') {
            params.set('mkt_order', this.sortOrder);
        } else {
            params.delete('mkt_order');
        }

        // Update search (market-specific parameter)
        if (this.searchTerm) {
            params.set('mkt_search', this.searchTerm);
        } else {
            params.delete('mkt_search');
        }

        // Update URL without reload
        const newUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
        window.history.pushState({}, '', newUrl);
    }

    async fetchMarketData() {
        try {
            const response = await fetch(`${API_BASE}/market/__data.json?hasOrders=true&hasSellOrders=true`);
            const json = await response.json();

            console.log('Raw market JSON:', json);

            // Use the same devalue decoder as InventoryViewer
            const decoded = viewer.decodeSvelteKitData(json);

            console.log('Decoded market data:', decoded);
            console.log('Decoded data type:', typeof decoded, Array.isArray(decoded));
            console.log('Decoded data keys:', decoded ? Object.keys(decoded) : 'null');

            // Extract items from the decoded data structure
            this.items = this.extractMarketItems(decoded);
            return this.items;
        } catch (error) {
            console.error('Error fetching market data:', error);
            throw error;
        }
    }

    extractMarketItems(data) {
        // Market data structure: the decoded data has a marketData property containing items
        const items = [];

        console.log('Extracting from data:', data);

        // Try to get the items array from different possible locations
        let itemsArray = null;

        if (Array.isArray(data)) {
            itemsArray = data;
        } else if (data && data.marketData && data.marketData.items && Array.isArray(data.marketData.items)) {
            itemsArray = data.marketData.items;
        } else if (data && data.items && Array.isArray(data.items)) {
            itemsArray = data.items;
        } else if (data && data.marketData && Array.isArray(data.marketData)) {
            itemsArray = data.marketData;
        }

        console.log('Items array found:', itemsArray ? itemsArray.length : 'null');

        if (itemsArray) {
            // Log first item to see structure
            if (itemsArray.length > 0) {
                console.log('First item in array:', itemsArray[0]);
                console.log('Item keys:', Object.keys(itemsArray[0]));
            }

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
                        description: item.description || '',
                        price: null, // Will be fetched on demand
                        seller: null, // Will be fetched on demand
                        claimName: null, // Will be fetched on demand
                        regionName: null, // Will be fetched on demand
                        regionId: null, // Will be fetched on demand
                        priceLoaded: false
                    });
                }
            }
        }

        console.log(`Extracted ${items.length} market items`);
        return items;
    }

    async fetchItemPrice(itemId) {
        try {
            const response = await fetch(`${API_BASE}/market/item/${itemId}/__data.json?hasOrders=true&hasSellOrders=true&x-sveltekit-invalidated=001`);
            const json = await response.json();
            const decoded = viewer.decodeSvelteKitData(json);

            console.log(`[Item ${itemId}] Decoded structure:`, decoded);
            console.log(`[Item ${itemId}] Decoded keys:`, decoded ? Object.keys(decoded) : 'null');

            if (!decoded) {
                console.log(`[Item ${itemId}] No decoded data`);
                return null;
            }

            // Try different possible locations for sellOrders
            let sellOrders = null;

            // Check if sellOrders is directly accessible
            if (decoded.sellOrders && Array.isArray(decoded.sellOrders)) {
                sellOrders = decoded.sellOrders;
                console.log(`[Item ${itemId}] Found sellOrders directly`);
            }
            // Check if it's nested in item
            else if (decoded.item && decoded.item.sellOrders && Array.isArray(decoded.item.sellOrders)) {
                sellOrders = decoded.item.sellOrders;
                console.log(`[Item ${itemId}] Found sellOrders in item`);
            }
            // Check if it's in marketItem
            else if (decoded.marketItem && decoded.marketItem.sellOrders && Array.isArray(decoded.marketItem.sellOrders)) {
                sellOrders = decoded.marketItem.sellOrders;
                console.log(`[Item ${itemId}] Found sellOrders in marketItem`);
            }
            // It might be in marketData for this endpoint
            else if (decoded.marketData) {
                console.log(`[Item ${itemId}] Checking marketData...`);
                // Check if the individual item endpoint uses the same structure as market list
                if (decoded.marketData.items) {
                    const item = decoded.marketData.items.find(i => i.id === itemId);
                    if (item && item.sellOrders && Array.isArray(item.sellOrders)) {
                        sellOrders = item.sellOrders;
                        console.log(`[Item ${itemId}] Found sellOrders in marketData.items`);
                    }
                } else if (decoded.marketData.sellOrders && Array.isArray(decoded.marketData.sellOrders)) {
                    sellOrders = decoded.marketData.sellOrders;
                    console.log(`[Item ${itemId}] Found sellOrders in marketData`);
                }
            }

            if (!sellOrders) {
                console.log(`[Item ${itemId}] Could not find sellOrders array`);
                return null;
            }

            if (sellOrders.length > 0) {
                console.log(`[Item ${itemId}] Found ${sellOrders.length} sell orders`);
                console.log(`[Item ${itemId}] First order:`, sellOrders[0]);

                // Extract prices from priceThreshold property and find the lowest
                const ordersWithPrices = sellOrders
                    .filter(order => order.priceThreshold != null && order.priceThreshold > 0)
                    .map(order => ({
                        price: order.priceThreshold,
                        seller: order.ownerUsername || 'Unknown',
                        claimName: order.claimName || 'Unknown',
                        regionName: order.regionName || 'Unknown',
                        regionId: order.regionId || null
                    }))
                    .sort((a, b) => a.price - b.price);

                console.log(`[Item ${itemId}] Orders with prices:`, ordersWithPrices);

                if (ordersWithPrices.length > 0) {
                    const cheapestOrder = ordersWithPrices[0];
                    console.log(`[Item ${itemId}] Cheapest order:`, cheapestOrder);
                    return {
                        price: cheapestOrder.price,
                        seller: cheapestOrder.seller,
                        claimName: cheapestOrder.claimName,
                        regionName: cheapestOrder.regionName,
                        regionId: cheapestOrder.regionId
                    };
                }
            }

            return null;
        } catch (error) {
            console.error(`Error fetching price for item ${itemId}:`, error);
            return null;
        }
    }

    async loadPricesForVisibleItems(items) {
        console.log('[loadPricesForVisibleItems] Called with', items.length, 'items');

        // Debug: check first few items
        if (items.length > 0) {
            console.log('[loadPricesForVisibleItems] First 3 items check:');
            items.slice(0, 3).forEach((item, i) => {
                console.log(`  Item ${i}: id=${item.id}, sellOrders=${item.sellOrders} (${typeof item.sellOrders}), priceLoaded=${item.priceLoaded}`);
            });
        }

        // Only fetch prices for items that don't have them yet
        const itemsNeedingPrices = items.filter(item => {
            const needsPrice = !item.priceLoaded && item.sellOrders > 0;
            return needsPrice;
        });

        console.log(`[loadPricesForVisibleItems] Total items: ${items.length}, Items needing prices: ${itemsNeedingPrices.length}`);
        if (itemsNeedingPrices.length > 0) {
            console.log('[loadPricesForVisibleItems] First item needing price:', itemsNeedingPrices[0]);
        } else {
            console.log('[loadPricesForVisibleItems] No items need prices. Reasons:');
            const alreadyLoaded = items.filter(item => item.priceLoaded).length;
            const noSellOrders = items.filter(item => !item.sellOrders || item.sellOrders === 0).length;
            console.log(`  - Already loaded: ${alreadyLoaded}`);
            console.log(`  - No sell orders: ${noSellOrders}`);
        }

        if (itemsNeedingPrices.length === 0) {
            return;
        }

        // Fetch prices in batches to avoid overwhelming the API
        const batchSize = 10;
        for (let i = 0; i < itemsNeedingPrices.length; i += batchSize) {
            const batch = itemsNeedingPrices.slice(i, i + batchSize);
            console.log(`Fetching prices for batch ${i / batchSize + 1}, ${batch.length} items`);
            await Promise.all(batch.map(async (item) => {
                const priceData = await this.fetchItemPrice(item.id);
                if (priceData) {
                    item.price = priceData.price;
                    item.seller = priceData.seller;
                    item.claimName = priceData.claimName;
                    item.regionName = priceData.regionName;
                    item.regionId = priceData.regionId;
                } else {
                    item.price = null;
                    item.seller = null;
                    item.claimName = null;
                    item.regionName = null;
                    item.regionId = null;
                }
                item.priceLoaded = true;
            }));
        }
    }

    getAvailableTags() {
        // Tags to exclude from the filter (not useful for market browsing)
        const excludedTags = new Set([
            'Seasonal',
            'Taming Items',
            'Writ',
            'Trader License',
            'Water',
            'Settlement Foundation Kit',
            'Sugar',
            'Salt',
            'Pitch',
            'Flint',
            'Empty Bucket',
            'Banking Kit',
            'Automata Heart',
            'Ancient Component',
            'Sap',
            'Tool Bundle',
            'Stick',
            'Hexite Capsule',
            'Construction Material',
            'Coins',
            'Food Waste',
            'Hex Coin Sack',
            'Schematic Fragments'
        ]);

        const tags = new Set();
        this.items.forEach(item => {
            if (item.tag && item.tag !== 'Unknown' && !excludedTags.has(item.tag)) {
                tags.add(item.tag);
            }
        });
        return Array.from(tags).sort();
    }

    getFilteredItems() {
        // Require at least one tag to be selected
        if (this.selectedTags.size === 0) {
            return [];
        }

        // Filter by selected tags (multi-select)
        let filtered = this.items.filter(item => this.selectedTags.has(item.tag));

        // Filter by rarity (selected rarity or above)
        if (this.selectedRarity !== 'all') {
            const rarityOrder = { 'Common': 1, 'Uncommon': 2, 'Rare': 3, 'Epic': 4, 'Legendary': 5, 'Mythic': 6 };
            const selectedRarityLevel = rarityOrder[this.selectedRarity] || 0;
            filtered = filtered.filter(item => {
                const itemRarityLevel = rarityOrder[item.rarity] || 0;
                return itemRarityLevel >= selectedRarityLevel;
            });
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
            } else if (this.sortBy === 'price') {
                // Sort by price, treating null as highest value
                const aPrice = a.price ?? Infinity;
                const bPrice = b.price ?? Infinity;
                comparison = aPrice - bPrice;
            } else if (this.sortBy === 'quantity') {
                comparison = a.sellOrders - b.sellOrders;
            }

            return this.sortOrder === 'desc' ? -comparison : comparison;
        });

        return filtered;
    }
}

// Initialize
const viewer = new InventoryViewer();
const marketViewer = new MarketViewer();

// Player Market Viewer Class
class PlayerMarketViewer {
    constructor() {
        this.selectedPlayer = null;
        this.sellOrders = [];
        this.buyOrders = [];
        this.sellOrdersSort = { column: 'itemName', direction: 'asc' };
        this.buyOrdersSort = { column: 'itemName', direction: 'asc' };
        this.cheapestCache = {}; // Cache to store cheapest price for each item
    }

    async fetchMarketDetailsForItem(itemId, itemTag) {
        // Try 'item' first, fallback to 'cargo' if 404
        let response = await fetch(
            `${API_BASE}/api/market/item/${itemId}`
        );

        if (response.status === 404) {
            // Try cargo instead
            response = await fetch(
                `${API_BASE}/api/market/cargo/${itemId}`
            );
        }

        if (!response.ok) {
            throw new Error(`Failed to fetch market details: ${response.status}`);
        }

        const data = await response.json();
        return data;
    }

    isPlayerCheapestSeller(order) {
        const playerId = this.selectedPlayer?.id;
        if (!playerId) return false;

        // Check cache first
        const cacheKey = order.itemId;
        if (this.cheapestCache[cacheKey]) {
            return this.cheapestCache[cacheKey].playerId === playerId &&
                   this.cheapestCache[cacheKey].price === order.price;
        }

        return false;
    }

    updateCheapestCache(itemId, cheapestPrice, cheapestPlayerId) {
        this.cheapestCache[itemId] = {
            price: cheapestPrice,
            playerId: cheapestPlayerId
        };
    }

    async fetchPlayerMarketData(playerId) {
        const response = await fetch(
            `${API_BASE}/api/market/player/${playerId}`
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch market data: ${response.status}`);
        }

        const data = await response.json();

        if (!data) {
            throw new Error('No market data returned');
        }

        // Store player info
        this.selectedPlayer = {
            id: data.playerId,
            username: data.playerUsername
        };

        // Parse sell orders and buy orders
        this.parseSellOrders(data.sellOrders || []);
        this.parseBuyOrders(data.buyOrders || []);

        return data;
    }

    parseSellOrders(sellOrders) {
        this.sellOrders = sellOrders.map(order => ({
            entityId: order.entityId,
            itemId: order.itemId,
            itemName: order.itemName || 'Unknown',
            itemTier: order.itemTier,
            itemRarity: order.itemRarityStr || 'Common',
            itemTag: order.itemTag,
            quantity: parseInt(order.quantity) || 0,
            price: parseInt(order.priceThreshold) || 0,
            claimName: order.claimName,
            claimLocationX: order.claimLocationX,
            claimLocationZ: order.claimLocationZ,
            regionName: order.regionName,
            regionId: order.regionId,
            isCheapest: null // Will be determined when market data is fetched
        }));

        // Calculate cheapest for each unique item
        this.calculateCheapestOrders();
    }

    async calculateCheapestOrders() {
        // Group orders by item ID to find cheapest price for each
        const itemGroups = {};

        for (const order of this.sellOrders) {
            if (!itemGroups[order.itemId]) {
                itemGroups[order.itemId] = [];
            }
            itemGroups[order.itemId].push(order);
        }

        // For each item, fetch market data to determine if player has cheapest
        for (const itemId of Object.keys(itemGroups)) {
            try {
                const itemTag = itemGroups[itemId][0]?.itemTag;
                const marketData = await this.fetchMarketDetailsForItem(itemId, itemTag);
                const allSellOrders = marketData.sellOrders || [];

                // Find the cheapest price across all sellers
                let cheapestPrice = Infinity;
                let cheapestOwnerId = null;

                for (const sellOrder of allSellOrders) {
                    const price = parseInt(sellOrder.priceThreshold) || 0;
                    if (price < cheapestPrice) {
                        cheapestPrice = price;
                        cheapestOwnerId = sellOrder.ownerEntityId;
                    }
                }

                // Update the isCheapest flag for player's orders
                for (const order of itemGroups[itemId]) {
                    order.isCheapest = order.price === cheapestPrice;
                }

                // Cache the result
                this.updateCheapestCache(itemId, cheapestPrice, cheapestOwnerId);
            } catch (error) {
                console.error(`Failed to fetch market data for item ${itemId}:`, error);
            }
        }

        // Re-render after calculating
        renderPlayerMarketOrders();
    }

    parseBuyOrders(buyOrders) {
        this.buyOrders = buyOrders.map(order => ({
            entityId: order.entityId,
            itemId: order.itemId,
            itemName: order.itemName || 'Unknown',
            itemTier: order.itemTier,
            itemRarity: order.itemRarityStr || 'Common',
            itemTag: order.itemTag,
            quantity: parseInt(order.quantity) || 0,
            price: parseInt(order.priceThreshold) || 0,
            claimName: order.claimName,
            claimLocationX: order.claimLocationX,
            claimLocationZ: order.claimLocationZ,
            regionName: order.regionName,
            regionId: order.regionId
        }));
    }

    sortOrders(orders, column, direction) {
        return [...orders].sort((a, b) => {
            let aVal = a[column];
            let bVal = b[column];

            // Handle tier sorting
            if (column === 'itemTier') {
                aVal = parseInt(aVal);
                bVal = parseInt(bVal);
            }

            // Handle rarity sorting
            if (column === 'itemRarity') {
                const rarityOrder = { 'Common': 1, 'Uncommon': 2, 'Rare': 3, 'Epic': 4, 'Legendary': 5, 'Mythic': 6 };
                aVal = rarityOrder[aVal] || 0;
                bVal = rarityOrder[bVal] || 0;
            }

            // Handle numeric columns
            if (column === 'quantity' || column === 'price') {
                aVal = parseInt(aVal) || 0;
                bVal = parseInt(bVal) || 0;
            }

            // Handle total value
            if (column === 'totalValue') {
                aVal = a.quantity * a.price;
                bVal = b.quantity * b.price;
            }

            // String comparison
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return direction === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            }

            // Numeric comparison
            return direction === 'asc' ? aVal - bVal : bVal - aVal;
        });
    }

    getSortedSellOrders() {
        return this.sortOrders(this.sellOrders, this.sellOrdersSort.column, this.sellOrdersSort.direction);
    }

    getSortedBuyOrders() {
        return this.sortOrders(this.buyOrders, this.buyOrdersSort.column, this.buyOrdersSort.direction);
    }
}

const playerMarketViewer = new PlayerMarketViewer();

// View Navigation Setup
function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const view = link.dataset.view;
            switchView(view);
        });
    });

    // Load view from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    if (viewParam && (viewParam === 'inventory' || viewParam === 'market' || viewParam === 'player-market')) {
        switchView(viewParam);
    }
}

async function switchView(view) {
    currentView = view;

    // Update active link
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.view === view);
    });

    // Update URL without reload
    const url = new URL(window.location);
    url.searchParams.set('view', view);
    window.history.pushState({}, '', url);

    // Show/hide appropriate sections
    const playerManagement = document.querySelector('.player-management');
    const viewControlsSection = document.querySelector('.view-controls');
    const marketControlsSection = document.querySelector('.market-controls');
    const footer = document.querySelector('footer');

    if (view === 'inventory') {
        // Show inventory sections
        if (playerManagement) playerManagement.style.display = '';

        // Remove market controls if present
        if (marketControlsSection) {
            marketControlsSection.remove();
        }

        // Show inventory controls if they exist (they might have been hidden)
        if (viewControlsSection) {
            viewControlsSection.style.display = '';
        }

        footer.style.display = 'flex';

        // Check if we need to restore inventory view from player-market or market
        const inventoryDisplay = document.querySelector('.inventory-display');
        const hasPlayerMarketContent = inventoryDisplay && inventoryDisplay.querySelector('#player-market-content');
        const hasMarketContent = inventoryDisplay && inventoryDisplay.querySelector('#market-content');

        // Restore original inventory HTML if it was replaced by market view
        if (originalInventoryHTML) {
            if (inventoryDisplay && hasMarketContent) {
                // Replace market display with inventory display
                inventoryDisplay.outerHTML = originalInventoryHTML.inventoryDisplay;
            }

            // Restore view controls if we stored them
            if (originalInventoryHTML.viewControls) {
                const existingViewControls = document.querySelector('.view-controls');
                if (!existingViewControls) {
                    // Insert the view-controls section
                    const inventoryDisplaySection = document.querySelector('.inventory-display');
                    if (inventoryDisplaySection) {
                        inventoryDisplaySection.insertAdjacentHTML('beforebegin', originalInventoryHTML.viewControls);
                    }
                }
            }

            // Clear the stored HTML so we can capture fresh state next time
            originalInventoryHTML = null;

            // Re-setup DOM elements and event listeners after HTML restoration
            viewer.setupDomElements();
            viewer.setupEventListeners();

            // Re-render inventory
            viewer.render();
        } else if (hasPlayerMarketContent) {
            // Coming from player-market view, just re-render inventory
            viewer.setupDomElements();
            viewer.render();
        }
    } else if (view === 'market') {
        if (playerManagement) playerManagement.style.display = 'none';

        // Hide inventory controls
        if (viewControlsSection) {
            viewControlsSection.style.display = 'none';
        }

        // Market controls will be shown by renderMarketView
        footer.style.display = 'none';
        await renderMarketView();
    } else if (view === 'player-market') {
        // Show player management for player selection
        if (playerManagement) playerManagement.style.display = '';

        // Hide inventory controls
        if (viewControlsSection) {
            viewControlsSection.style.display = 'none';
        }

        // Remove market controls if present
        if (marketControlsSection) {
            marketControlsSection.remove();
        }

        footer.style.display = 'none';
        await renderPlayerMarketView();
    }
}

// Store original inventory HTML so we can restore it
let originalInventoryHTML = null;

async function renderMarketView() {
    const main = document.querySelector('main');

    // Check if market view is already rendered
    const existingMarketControls = document.querySelector('.market-controls');
    const existingMarketContent = document.getElementById('market-content');

    if (existingMarketControls && existingMarketContent) {
        // Market view already exists, just ensure tags are populated and refresh the data
        const tags = marketViewer.getAvailableTags();
        const tagContainer = document.getElementById('tag-filter-container');

        // Re-render tags if container is empty
        if (tagContainer && tagContainer.children.length === 0) {
            renderTagFilters(tags);
            setupMarketEventListeners();
        }

        renderMarketTable();
        document.getElementById('loading-overlay').classList.add('hidden');
        return;
    }

    // Store the original inventory sections before replacing them (only once)
    if (!originalInventoryHTML) {
        const inventoryDisplay = document.querySelector('.inventory-display');
        const viewControls = document.querySelector('.view-controls');

        if (inventoryDisplay) {
            originalInventoryHTML = {
                inventoryDisplay: inventoryDisplay.outerHTML,
                viewControls: viewControls ? viewControls.outerHTML : null
            };
        }
    }

    // Show loading
    document.getElementById('loading-overlay').classList.remove('hidden');

    try {
        // Fetch market data if not already loaded
        if (marketViewer.items.length === 0) {
            await marketViewer.fetchMarketData();
        }

        const tags = marketViewer.getAvailableTags();

        // Find and replace inventory display section
        const inventoryDisplay = document.querySelector('.inventory-display');

        if (inventoryDisplay && !document.querySelector('.market-controls')) {
            inventoryDisplay.outerHTML = `
                <section class="market-controls">
                    <div class="controls-header" data-collapse-target="market-controls">
                        <div style="display: flex; align-items: center;">
                            <h2>Market Filters</h2>
                        </div>
                        <div class="stats-inline">
                            <div class="stat-inline">
                                <span class="stat-value" id="market-stat-total">0</span>
                                <span class="stat-label">Total</span>
                            </div>
                            <div class="stat-inline">
                                <span class="stat-value" id="market-stat-filtered">0</span>
                                <span class="stat-label">Filtered</span>
                            </div>
                            <div class="stat-inline">
                                <span class="stat-value" id="market-stat-available">0</span>
                                <span class="stat-label">Available</span>
                            </div>
                        </div>
                    </div>
                    <div class="tag-filter-section">
                        <div class="tag-filter-header">
                            <label>Item Types:</label>
                            <div class="tag-filter-actions">
                                <button type="button" id="select-all-tags" class="tag-action-btn">Select All</button>
                                <button type="button" id="clear-all-tags" class="tag-action-btn">Clear All</button>
                            </div>
                        </div>
                        <div id="tag-filter-container" class="tag-pill-container"></div>
                    </div>
                    <div class="controls-row">
                        <div class="control-group">
                            <label>Rarity (or above):</label>
                            <select id="market-rarity-filter">
                                <option value="all">All Rarities</option>
                                <option value="Common">Common+</option>
                                <option value="Uncommon">Uncommon+</option>
                                <option value="Rare">Rare+</option>
                                <option value="Epic">Epic+</option>
                                <option value="Legendary">Legendary+</option>
                                <option value="Mythic">Mythic</option>
                            </select>
                        </div>
                        <div class="control-group">
                            <label>Sort By:</label>
                            <select id="market-sort-by">
                                <option value="name">Name</option>
                                <option value="tier">Tier</option>
                                <option value="rarity">Rarity</option>
                                <option value="price">Price</option>
                                <option value="quantity">Quantity</option>
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
                <section class="inventory-display">
                    <div id="market-content"></div>
                </section>
            `;
        }

        // Render tag filter checkboxes
        renderTagFilters(tags);

        // Setup event listeners
        setupMarketEventListeners();

        // Initial render
        renderMarketTable();

    } catch (error) {
        const inventoryDisplay = document.querySelector('.inventory-display') || document.querySelector('.market-filters');
        if (inventoryDisplay) {
            inventoryDisplay.innerHTML = `<p class="error-message">Error loading market data: ${error.message}</p>`;
        }
    } finally {
        document.getElementById('loading-overlay').classList.add('hidden');
    }
}

// Player Market View Rendering
async function renderPlayerMarketView() {
    const inventoryDisplay = document.querySelector('.inventory-display');

    if (!inventoryDisplay) {
        console.error('Inventory display section not found');
        return;
    }

    // Replace content with player market view
    inventoryDisplay.innerHTML = `
        <div id="player-market-content" style="background: var(--bg-secondary); padding: 1rem; border-radius: 12px; border: 1px solid var(--border-subtle); box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);">
            <p style="text-align: center; color: var(--text-muted); padding: 2rem;">
                Select a player from above to view their market orders.
            </p>
        </div>
    `;

    // If there are already players loaded, render for the first one
    if (viewer.players.size > 0) {
        const firstPlayerId = viewer.players.keys().next().value;
        await loadPlayerMarketData(firstPlayerId);
    }
}

async function loadPlayerMarketData(playerId) {
    document.getElementById('loading-overlay').classList.remove('hidden');

    try {
        // Fetch player market data - this also sets playerMarketViewer.selectedPlayer
        await playerMarketViewer.fetchPlayerMarketData(playerId);

        // Update player list to show selected state
        viewer.renderPlayerList();

        // Render the market orders
        renderPlayerMarketOrders();
    } catch (error) {
        console.error('Error loading player market data:', error);
        const content = document.getElementById('player-market-content');
        if (content) {
            content.innerHTML = `<p class="error-message">Error loading market data: ${error.message}</p>`;
        }
    } finally {
        document.getElementById('loading-overlay').classList.add('hidden');
    }
}

function renderPlayerMarketOrders() {
    const content = document.getElementById('player-market-content');
    if (!content) return;

    const player = playerMarketViewer.selectedPlayer;
    const sellOrders = playerMarketViewer.getSortedSellOrders();
    const buyOrders = playerMarketViewer.getSortedBuyOrders();

    content.innerHTML = `
        <div style="margin-bottom: 1.5rem;">
            <h2 style="font-size: 1rem; font-weight: 600; color: var(--text-primary); margin-bottom: 1rem;">
                Market Orders for ${escapeHtml(player.username)}
            </h2>
        </div>

        <!-- Sell Orders Section -->
        <div style="margin-bottom: 2rem;">
            <div class="section-header" style="margin-bottom: 0.75rem;">
                <h3 style="font-size: 0.875rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin: 0;">
                    Sell Orders (${playerMarketViewer.sellOrders.length})
                </h3>
            </div>
            ${playerMarketViewer.sellOrders.length > 0 ? renderOrdersTable(sellOrders, 'sell') : '<p style="color: var(--text-muted); padding: 1rem; text-align: center;">No sell orders</p>'}
        </div>

        <!-- Buy Orders Section -->
        <div>
            <div class="section-header" style="margin-bottom: 0.75rem;">
                <h3 style="font-size: 0.875rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin: 0;">
                    Buy Orders (${playerMarketViewer.buyOrders.length})
                </h3>
            </div>
            ${playerMarketViewer.buyOrders.length > 0 ? renderOrdersTable(buyOrders, 'buy') : '<p style="color: var(--text-muted); padding: 1rem; text-align: center;">No buy orders</p>'}
        </div>
    `;

    // Setup sort handlers after rendering
    setupPlayerMarketSortHandlers();
}

function renderOrdersTable(orders, type) {
    const sortState = type === 'sell' ? playerMarketViewer.sellOrdersSort : playerMarketViewer.buyOrdersSort;
    const isSellOrders = type === 'sell';

    const getSortIndicator = (column) => {
        if (sortState.column === column) {
            return sortState.direction === 'asc' ? ' ▲' : ' ▼';
        }
        return '';
    };

    return `
        <table class="inventory-table">
            <thead>
                <tr>
                    <th class="sortable-header" data-sort="itemName" data-type="${type}" style="cursor: pointer;">Item${getSortIndicator('itemName')}</th>
                    <th class="sortable-header" data-sort="itemTier" data-type="${type}" style="cursor: pointer;">Tier${getSortIndicator('itemTier')}</th>
                    <th class="sortable-header" data-sort="itemRarity" data-type="${type}" style="cursor: pointer;">Rarity${getSortIndicator('itemRarity')}</th>
                    <th class="sortable-header" data-sort="quantity" data-type="${type}" style="cursor: pointer;">Quantity${getSortIndicator('quantity')}</th>
                    <th class="sortable-header" data-sort="price" data-type="${type}" style="cursor: pointer;">Price${getSortIndicator('price')}</th>
                    <th class="sortable-header" data-sort="totalValue" data-type="${type}" style="cursor: pointer;">Total Value${getSortIndicator('totalValue')}</th>
                    ${isSellOrders ? '<th>Cheapest?</th>' : ''}
                    <th class="sortable-header" data-sort="claimName" data-type="${type}" style="cursor: pointer;">Location${getSortIndicator('claimName')}</th>
                </tr>
            </thead>
            <tbody>
                ${orders.map(order => {
                    const rarity = (order.itemRarity || 'common').toLowerCase();
                    const cheapestIndicator = isSellOrders && order.isCheapest !== null
                        ? (order.isCheapest ? '<span style="color: #22c55e; font-weight: 600;">✓</span>' : '<span style="color: var(--text-muted);">✗</span>')
                        : (isSellOrders ? '<span style="color: var(--text-muted);">...</span>' : '');

                    return `
                        <tr class="rarity-row-${rarity} ${isSellOrders ? 'market-row-clickable' : ''}"
                            ${isSellOrders ? `onclick="showMarketDetails(${order.itemId})" style="cursor: pointer;"` : ''}>
                            <td class="item-name">${escapeHtml(order.itemName)}</td>
                            <td><span class="tier-badge">T${order.itemTier}</span></td>
                            <td><span class="rarity-${rarity}">${order.itemRarity || 'Common'}</span></td>
                            <td>${order.quantity.toLocaleString()}</td>
                            <td>${order.price.toLocaleString()}</td>
                            <td style="font-weight: 500;">${(order.quantity * order.price).toLocaleString()}</td>
                            ${isSellOrders ? `<td style="text-align: center;">${cheapestIndicator}</td>` : ''}
                            <td>${order.claimName ? `<span style="font-weight: 500;">${escapeHtml(order.claimName)}</span>${order.regionName ? `<span style="font-size: 0.75rem; color: var(--text-muted);"> - ${escapeHtml(order.regionName)}</span>` : ''}` : 'N/A'}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

function setupPlayerMarketSortHandlers() {
    document.querySelectorAll('.sortable-header').forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.sort;
            const type = header.dataset.type;
            const sortState = type === 'sell' ? playerMarketViewer.sellOrdersSort : playerMarketViewer.buyOrdersSort;

            // Toggle direction if same column, otherwise reset to ascending
            if (sortState.column === column) {
                sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                sortState.column = column;
                sortState.direction = 'asc';
            }

            // Re-render the orders
            renderPlayerMarketOrders();
        });
    });
}

// Market Details Modal
async function showMarketDetails(itemId) {
    // Show loading overlay
    document.getElementById('loading-overlay').classList.remove('hidden');

    try {
        const playerOrder = playerMarketViewer.sellOrders.find(o => o.itemId === itemId);

        if (!playerOrder) {
            throw new Error('Player order not found');
        }

        const marketData = await playerMarketViewer.fetchMarketDetailsForItem(itemId, playerOrder.itemTag);

        // Get all sell orders sorted by price
        const allSellOrders = (marketData.sellOrders || []).map(order => ({
            ...order,
            price: parseInt(order.priceThreshold) || 0,
            quantity: parseInt(order.quantity) || 0,
            isPlayer: order.ownerEntityId === playerMarketViewer.selectedPlayer?.id
        })).sort((a, b) => a.price - b.price);

        const playerPrice = playerOrder.price;

        // Separate into cheaper, same price, and more expensive
        const cheaperOrders = allSellOrders
            .filter(o => o.price < playerPrice)
            .slice(-5); // Take last 5 (closest to player's price)

        const samePriceOrders = allSellOrders
            .filter(o => o.price === playerPrice && !o.isPlayer);

        const moreExpensiveOrders = allSellOrders
            .filter(o => o.price > playerPrice)
            .slice(0, 5); // Take first 5 (closest to player's price)

        // Render the modal
        renderMarketDetailsModal(marketData.item, playerOrder, cheaperOrders, samePriceOrders, moreExpensiveOrders);
    } catch (error) {
        console.error('Error loading market details:', error);
        alert(`Failed to load market details: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').classList.add('hidden');
    }
}

function renderMarketDetailsModal(item, playerOrder, cheaperOrders, samePriceOrders, moreExpensiveOrders) {
    // Create modal if it doesn't exist
    let modal = document.getElementById('market-details-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'market-details-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${escapeHtml(playerOrder.itemName)} - Market Comparison</h3>
                <button class="modal-close" onclick="closeMarketDetailsModal()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="market-section-label player-section">Your Order</div>
                <div class="market-order player-order">
                    <div class="market-order-seller">You</div>
                    <div class="market-order-quantity">Qty: ${playerOrder.quantity.toLocaleString()}</div>
                    <div class="market-order-price">${playerOrder.price.toLocaleString()}</div>
                </div>

                ${samePriceOrders.length > 0 ? `
                    <div class="market-section-label" style="margin-top: 1rem; color: var(--warning);">Same Price (${samePriceOrders.length})</div>
                    ${samePriceOrders.map(order => `
                        <div class="market-order" style="border-left: 3px solid var(--warning);">
                            <div class="market-order-seller">${escapeHtml(order.ownerUsername || 'Unknown')}</div>
                            <div class="market-order-quantity">Qty: ${order.quantity.toLocaleString()}</div>
                            <div class="market-order-price" style="color: var(--warning);">${order.price.toLocaleString()}</div>
                        </div>
                    `).join('')}
                ` : ''}

                ${cheaperOrders.length > 0 ? `
                    <div class="market-section-label cheaper-section" style="margin-top: 1rem;">Cheaper Orders (${cheaperOrders.length})</div>
                    ${cheaperOrders.map(order => `
                        <div class="market-order cheaper">
                            <div class="market-order-seller">${escapeHtml(order.ownerUsername || 'Unknown')}</div>
                            <div class="market-order-quantity">Qty: ${order.quantity.toLocaleString()}</div>
                            <div class="market-order-price">${order.price.toLocaleString()}</div>
                        </div>
                    `).join('')}
                ` : '<p style="color: var(--success); font-size: 0.75rem; margin-top: 1rem; font-weight: 500;">✓ You have the cheapest price!</p>'}

                ${moreExpensiveOrders.length > 0 ? `
                    <div class="market-section-label expensive-section" style="margin-top: 1rem;">More Expensive Orders (${moreExpensiveOrders.length})</div>
                    ${moreExpensiveOrders.map(order => `
                        <div class="market-order more-expensive">
                            <div class="market-order-seller">${escapeHtml(order.ownerUsername || 'Unknown')}</div>
                            <div class="market-order-quantity">Qty: ${order.quantity.toLocaleString()}</div>
                            <div class="market-order-price">${order.price.toLocaleString()}</div>
                        </div>
                    `).join('')}
                ` : ''}
            </div>
        </div>
    `;

    // Show modal with active class for CSS transitions
    modal.classList.add('active');
}

function closeMarketDetailsModal() {
    const modal = document.getElementById('market-details-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function renderTagFilters(tags) {
    const container = document.getElementById('tag-filter-container');
    if (!container) {
        console.error('Tag filter container not found');
        return;
    }
    container.innerHTML = tags.map(tag => `
        <button type="button" class="tag-pill ${marketViewer.selectedTags.has(tag) ? 'active' : ''}" data-tag="${tag}">
            ${tag}
        </button>
    `).join('');
}

function setupMarketEventListeners() {
    // Apply URL parameters to UI controls
    document.getElementById('market-rarity-filter').value = marketViewer.selectedRarity;
    document.getElementById('market-sort-by').value = marketViewer.sortBy;
    document.getElementById('market-sort-order').value = marketViewer.sortOrder;
    document.getElementById('market-search').value = marketViewer.searchTerm;

    // Tag pill buttons
    document.querySelectorAll('.tag-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
            const tag = e.currentTarget.dataset.tag;
            if (marketViewer.selectedTags.has(tag)) {
                marketViewer.selectedTags.delete(tag);
                e.currentTarget.classList.remove('active');
            } else {
                marketViewer.selectedTags.add(tag);
                e.currentTarget.classList.add('active');
            }
            marketViewer.updateUrl();
            renderMarketTable();
        });
    });

    // Select All button
    const selectAllBtn = document.getElementById('select-all-tags');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            const allTags = marketViewer.getAvailableTags();
            allTags.forEach(tag => marketViewer.selectedTags.add(tag));
            document.querySelectorAll('.tag-pill').forEach(pill => {
                pill.classList.add('active');
            });
            marketViewer.updateUrl();
            renderMarketTable();
        });
    }

    // Clear All button
    const clearAllBtn = document.getElementById('clear-all-tags');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
            marketViewer.selectedTags.clear();
            document.querySelectorAll('.tag-pill').forEach(pill => {
                pill.classList.remove('active');
            });
            marketViewer.updateUrl();
            renderMarketTable();
        });
    }

    // Rarity filter
    document.getElementById('market-rarity-filter').addEventListener('change', (e) => {
        marketViewer.selectedRarity = e.target.value;
        marketViewer.updateUrl();
        renderMarketTable();
    });

    // Sort controls
    document.getElementById('market-sort-by').addEventListener('change', (e) => {
        marketViewer.sortBy = e.target.value;
        marketViewer.updateUrl();
        renderMarketTable();
    });

    document.getElementById('market-sort-order').addEventListener('change', (e) => {
        marketViewer.sortOrder = e.target.value;
        marketViewer.updateUrl();
        renderMarketTable();
    });

    // Search
    document.getElementById('market-search').addEventListener('input', (e) => {
        marketViewer.searchTerm = e.target.value;
        marketViewer.updateUrl();
        renderMarketTable();
    });
}

async function renderMarketTable() {
    const items = marketViewer.getFilteredItems();
    const content = document.getElementById('market-content');

    console.log('[renderMarketTable] Total filtered items:', items.length);
    if (items.length > 0) {
        console.log('[renderMarketTable] First item:', items[0]);
        console.log('[renderMarketTable] First item sellOrders:', items[0].sellOrders, 'Type:', typeof items[0].sellOrders);
        console.log('[renderMarketTable] First item priceLoaded:', items[0].priceLoaded);
    }

    // Update stats
    document.getElementById('market-stat-total').textContent = marketViewer.items.length.toLocaleString();
    document.getElementById('market-stat-filtered').textContent = items.length.toLocaleString();

    // Calculate total available quantity across all filtered items
    const totalAvailable = items.reduce((sum, item) => sum + item.sellOrders, 0);
    document.getElementById('market-stat-available').textContent = totalAvailable.toLocaleString();

    if (items.length === 0) {
        const message = marketViewer.selectedTags.size === 0
            ? 'Please select at least one tag/type to view market items.'
            : 'No items match your filters.';
        content.innerHTML = `<p class="empty-state">${message}</p>`;
        return;
    }

    // Helper function to get sort indicator
    const getSortIndicator = (columnName) => {
        if (marketViewer.sortBy === columnName) {
            return marketViewer.sortOrder === 'asc' ? ' ▲' : ' ▼';
        }
        return '';
    };

    // Render initial table with loading state for prices
    content.innerHTML = `
        <table class="inventory-table">
            <thead>
                <tr>
                    <th class="sortable-header" data-sort="name" style="cursor: pointer;">Item${getSortIndicator('name')}</th>
                    <th class="sortable-header" data-sort="tier" style="cursor: pointer;">Tier${getSortIndicator('tier')}</th>
                    <th class="sortable-header" data-sort="rarity" style="cursor: pointer;">Rarity${getSortIndicator('rarity')}</th>
                    <th>Tag/Type</th>
                    <th class="sortable-header" data-sort="price" style="cursor: pointer;">Price${getSortIndicator('price')}</th>
                    <th>Seller</th>
                    <th>Location</th>
                    <th class="sortable-header" data-sort="quantity" style="cursor: pointer;">Available${getSortIndicator('quantity')}</th>
                </tr>
            </thead>
            <tbody id="market-table-body">
                ${items.map(item => `
                    <tr class="rarity-row-${item.rarity.toLowerCase()}" data-item-id="${item.id}">
                        <td class="item-name">
                            <a href="https://bitjita.com/market/item/${item.id}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: none;">
                                ${escapeHtml(item.name)}
                            </a>
                        </td>
                        <td><span class="tier-badge">T${item.tier}</span></td>
                        <td><span class="rarity-${item.rarity.toLowerCase()}">${item.rarity}</span></td>
                        <td>${escapeHtml(item.tag)}</td>
                        <td class="price-value">${item.priceLoaded ? (item.price != null ? item.price.toLocaleString() : 'N/A') : '<span class="loading-text">Loading...</span>'}</td>
                        <td class="seller-value">${item.seller || '<span class="loading-text">Loading...</span>'}</td>
                        <td class="location-value">
                            ${item.priceLoaded ? (item.claimName ? `<div style="text-align: center;"><div style="font-weight: 600;">${escapeHtml(item.claimName)}</div><div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(item.regionName)}${item.regionId ? ' (' + item.regionId + ')' : ''}</div></div>` : 'N/A') : '<span class="loading-text">Loading...</span>'}
                        </td>
                        <td class="count-value">${item.sellOrders.toLocaleString()}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    // Add click handlers to sortable headers
    document.querySelectorAll('.sortable-header').forEach(header => {
        header.addEventListener('click', () => {
            const sortColumn = header.dataset.sort;
            // Toggle order if clicking the same column, otherwise default to ascending
            if (marketViewer.sortBy === sortColumn) {
                marketViewer.sortOrder = marketViewer.sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                marketViewer.sortBy = sortColumn;
                marketViewer.sortOrder = 'asc';
            }
            marketViewer.updateUrl();
            // Update UI controls to match
            document.getElementById('market-sort-by').value = marketViewer.sortBy;
            document.getElementById('market-sort-order').value = marketViewer.sortOrder;
            renderMarketTable();
        });
    });

    // Load prices asynchronously
    await marketViewer.loadPricesForVisibleItems(items);

    // Update the table with loaded prices
    const tbody = document.getElementById('market-table-body');
    if (tbody) {
        items.forEach(item => {
            const row = tbody.querySelector(`tr[data-item-id="${item.id}"]`);
            if (row) {
                const priceCell = row.querySelector('.price-value');
                const sellerCell = row.querySelector('.seller-value');
                const locationCell = row.querySelector('.location-value');

                if (priceCell) {
                    priceCell.innerHTML = item.price != null ? item.price.toLocaleString() : 'N/A';
                }
                if (sellerCell) {
                    sellerCell.textContent = item.seller || 'N/A';
                }
                if (locationCell) {
                    if (item.claimName) {
                        const regionInfo = item.regionName ? ` - ${escapeHtml(item.regionName)}${item.regionId ? ' (' + item.regionId + ')' : ''}` : '';
                        locationCell.innerHTML = `<span style="font-weight: 500;">${escapeHtml(item.claimName)}</span><span style="font-size: 0.75rem; color: var(--text-muted);">${regionInfo}</span>`;
                    } else {
                        locationCell.textContent = 'N/A';
                    }
                }
            }
        });
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize navigation
setupNavigation();

// Display version
document.getElementById('version-display').textContent = VERSION;

// Setup collapse functionality
function setupCollapseHeaders() {
    // Remove any existing listeners to prevent duplicates
    const headers = document.querySelectorAll('[data-collapse-target]');

    headers.forEach(header => {
        // Clone and replace to remove old listeners
        const newHeader = header.cloneNode(true);
        header.parentNode.replaceChild(newHeader, header);
    });

    // Add click listeners to all collapsible headers
    document.querySelectorAll('[data-collapse-target]').forEach(header => {
        header.addEventListener('click', () => {
            const targetClass = header.dataset.collapseTarget;
            const section = document.querySelector('.' + targetClass);

            if (section) {
                section.classList.toggle('collapsed');

                // Save collapse state to localStorage
                const isCollapsed = section.classList.contains('collapsed');
                localStorage.setItem(`collapse-${targetClass}`, isCollapsed);
            }
        });
    });

    // Restore collapse states from localStorage
    ['player-management', 'view-controls', 'market-controls'].forEach(sectionClass => {
        const section = document.querySelector('.' + sectionClass);
        const isCollapsed = localStorage.getItem(`collapse-${sectionClass}`) === 'true';

        if (section && isCollapsed) {
            section.classList.add('collapsed');
        }
    });
}

// Initial setup
setupCollapseHeaders();

// Re-setup collapse headers when switching to market view
// (since market controls are dynamically created)
const originalRenderMarketView = renderMarketView;
window.renderMarketView = async function() {
    await originalRenderMarketView();
    setupCollapseHeaders();
};
