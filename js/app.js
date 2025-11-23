// Bitcraft Inventory Tracker
class InventoryTracker {
    constructor() {
        this.inventory = this.loadInventory();
        this.init();
    }

    init() {
        // DOM elements
        this.itemNameInput = document.getElementById('item-name');
        this.itemQuantityInput = document.getElementById('item-quantity');
        this.itemCategorySelect = document.getElementById('item-category');
        this.addBtn = document.getElementById('add-btn');
        this.searchInput = document.getElementById('search');
        this.filterCategorySelect = document.getElementById('filter-category');
        this.inventoryList = document.getElementById('inventory-list');
        this.totalItemsEl = document.getElementById('total-items');
        this.totalQuantityEl = document.getElementById('total-quantity');
        this.exportBtn = document.getElementById('export-btn');
        this.importBtn = document.getElementById('import-btn');
        this.importFile = document.getElementById('import-file');
        this.clearBtn = document.getElementById('clear-btn');

        // Event listeners
        this.addBtn.addEventListener('click', () => this.addItem());
        this.itemNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addItem();
        });
        this.searchInput.addEventListener('input', () => this.render());
        this.filterCategorySelect.addEventListener('change', () => this.render());
        this.exportBtn.addEventListener('click', () => this.exportData());
        this.importBtn.addEventListener('click', () => this.importFile.click());
        this.importFile.addEventListener('change', (e) => this.importData(e));
        this.clearBtn.addEventListener('click', () => this.clearAll());

        this.render();
    }

    loadInventory() {
        const saved = localStorage.getItem('bitcraft-inventory');
        return saved ? JSON.parse(saved) : [];
    }

    saveInventory() {
        localStorage.setItem('bitcraft-inventory', JSON.stringify(this.inventory));
    }

    addItem() {
        const name = this.itemNameInput.value.trim();
        const quantity = parseInt(this.itemQuantityInput.value) || 1;
        const category = this.itemCategorySelect.value;

        if (!name) {
            this.itemNameInput.focus();
            return;
        }

        // Check if item already exists (case-insensitive)
        const existingIndex = this.inventory.findIndex(
            item => item.name.toLowerCase() === name.toLowerCase() && item.category === category
        );

        if (existingIndex !== -1) {
            this.inventory[existingIndex].quantity += quantity;
        } else {
            this.inventory.push({
                id: Date.now(),
                name,
                quantity,
                category
            });
        }

        this.saveInventory();
        this.render();

        // Clear inputs
        this.itemNameInput.value = '';
        this.itemQuantityInput.value = '1';
        this.itemNameInput.focus();
    }

    updateQuantity(id, delta) {
        const item = this.inventory.find(i => i.id === id);
        if (item) {
            item.quantity += delta;
            if (item.quantity <= 0) {
                this.deleteItem(id);
            } else {
                this.saveInventory();
                this.render();
            }
        }
    }

    deleteItem(id) {
        this.inventory = this.inventory.filter(i => i.id !== id);
        this.saveInventory();
        this.render();
    }

    getFilteredInventory() {
        const search = this.searchInput.value.toLowerCase();
        const category = this.filterCategorySelect.value;

        return this.inventory.filter(item => {
            const matchesSearch = item.name.toLowerCase().includes(search);
            const matchesCategory = category === 'all' || item.category === category;
            return matchesSearch && matchesCategory;
        });
    }

    render() {
        const filtered = this.getFilteredInventory();

        if (filtered.length === 0) {
            this.inventoryList.innerHTML = `
                <div class="empty-state">
                    ${this.inventory.length === 0
                        ? 'No items in inventory. Add some items above!'
                        : 'No items match your search.'}
                </div>
            `;
        } else {
            // Sort alphabetically by name
            filtered.sort((a, b) => a.name.localeCompare(b.name));

            this.inventoryList.innerHTML = filtered.map(item => `
                <div class="inventory-item" data-id="${item.id}">
                    <span class="item-name">${this.escapeHtml(item.name)}</span>
                    <span class="item-category">${item.category}</span>
                    <div class="item-quantity">
                        <button class="quantity-btn" onclick="tracker.updateQuantity(${item.id}, -1)">-</button>
                        <span class="quantity-value">${item.quantity}</span>
                        <button class="quantity-btn" onclick="tracker.updateQuantity(${item.id}, 1)">+</button>
                    </div>
                    <div class="item-actions">
                        <button class="delete-btn" onclick="tracker.deleteItem(${item.id})">Delete</button>
                    </div>
                </div>
            `).join('');
        }

        this.updateStats();
    }

    updateStats() {
        this.totalItemsEl.textContent = this.inventory.length;
        this.totalQuantityEl.textContent = this.inventory.reduce((sum, item) => sum + item.quantity, 0);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    exportData() {
        const data = JSON.stringify(this.inventory, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bitcraft-inventory-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (Array.isArray(data)) {
                    // Merge with existing inventory
                    data.forEach(item => {
                        if (item.name && item.quantity && item.category) {
                            const existingIndex = this.inventory.findIndex(
                                i => i.name.toLowerCase() === item.name.toLowerCase() && i.category === item.category
                            );
                            if (existingIndex !== -1) {
                                this.inventory[existingIndex].quantity += item.quantity;
                            } else {
                                this.inventory.push({
                                    id: Date.now() + Math.random(),
                                    name: item.name,
                                    quantity: item.quantity,
                                    category: item.category
                                });
                            }
                        }
                    });
                    this.saveInventory();
                    this.render();
                    alert('Inventory imported successfully!');
                }
            } catch (err) {
                alert('Error importing file. Please make sure it\'s a valid JSON file.');
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    }

    clearAll() {
        if (confirm('Are you sure you want to clear all inventory? This cannot be undone.')) {
            this.inventory = [];
            this.saveInventory();
            this.render();
        }
    }
}

// Initialize the tracker
const tracker = new InventoryTracker();
