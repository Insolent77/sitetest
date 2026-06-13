const db = require('./db');
const products = db.prepare('SELECT * FROM products').all();
console.log(products);