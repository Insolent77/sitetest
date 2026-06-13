const Database = require('better-sqlite3');
const db = new Database('shop.db');

// Создаём таблицы, если их нет
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    description TEXT,
    image TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT,
    address TEXT,
    items TEXT,
    total INTEGER,
    date TEXT
  );
`);

// Добавляем колонку status, если её ещё нет
try {
  db.exec(`ALTER TABLE orders ADD COLUMN status TEXT DEFAULT 'Новый'`);
} catch (e) {
  // колонка уже существует - игнорируем ошибку
}

// Если таблица products пустая - заполняем из products.json
const count = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
if (count === 0) {
  const fs = require('fs');
  const products = JSON.parse(fs.readFileSync('./data/products.json', 'utf-8'));
  const insert = db.prepare('INSERT INTO products (name, price, description, image) VALUES (?, ?, ?, ?)');
  products.forEach(p => {
    insert.run(p.name, p.price, p.description, p.image);
  });
  console.log('Товары загружены в БД');
}

module.exports = db;