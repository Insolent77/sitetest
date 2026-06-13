const express = require('express');
const session = require('express-session');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.static('public'));

app.use(session({
  secret: 'super-secret-key',
  resave: false,
  saveUninitialized: true
}));
app.use(express.urlencoded({ extended: true }));

// Главная страница
app.get('/', (req, res) => {
  const popularProducts = db.prepare('SELECT * FROM products LIMIT 2').all();
  res.render('index', { title: 'Моя аптека', popularProducts: popularProducts });
});

// Страница каталога
app.get('/products', (req, res) => {
  const search = req.query.search || '';
  let products;

  if (search) {
    products = db.prepare('SELECT * FROM products WHERE name LIKE ?').all(`%${search}%`);
  } else {
    products = db.prepare('SELECT * FROM products').all();
  }

  res.render('products', { title: 'Каталог', products: products, search: search });
});

// Страница одного товара
app.get('/product/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);

  if (!product) {
    return res.status(404).send('Товар не найден');
  }

  res.render('product', { title: product.name, product: product });
});

// Добавить товар в корзину
app.post('/cart/add/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);

  if (!product) {
    return res.status(404).send('Товар не найден');
  }

  if (!req.session.cart) {
    req.session.cart = [];
  }

  req.session.cart.push(product);
  res.redirect('/cart');
});

// Страница корзины
app.get('/cart', (req, res) => {
  const cart = req.session.cart || [];
  const total = cart.reduce((sum, item) => sum + item.price, 0);
  res.render('cart', { title: 'Корзина', cart: cart, total: total });
});

// Удалить товар из корзины по индексу
app.post('/cart/remove/:index', (req, res) => {
  const index = parseInt(req.params.index);

  if (req.session.cart && req.session.cart[index]) {
    req.session.cart.splice(index, 1);
  }

  res.redirect('/cart');
});

// Страница оформления заказа
app.get('/checkout', (req, res) => {
  const cart = req.session.cart || [];
  const total = cart.reduce((sum, item) => sum + item.price, 0);

  if (cart.length === 0) {
    return res.redirect('/cart');
  }

  res.render('checkout', { title: 'Оформление заказа', cart: cart, total: total, errors: [], old: {} });
});

// Обработка отправки заказа
app.post('/checkout', (req, res) => {
  const cart = req.session.cart || [];
  const total = cart.reduce((sum, item) => sum + item.price, 0);

  const { name, phone, address } = req.body;
  const errors = [];

  if (!name || name.trim().length < 2) {
    errors.push('Укажите корректное имя (минимум 2 символа).');
  }
  if (!phone || !/^[\d\s\+\-\(\)]{6,20}$/.test(phone)) {
    errors.push('Укажите корректный номер телефона.');
  }
  if (!address || address.trim().length < 5) {
    errors.push('Укажите корректный адрес доставки.');
  }
  if (cart.length === 0) {
    errors.push('Корзина пуста.');
  }

  if (errors.length > 0) {
    return res.render('checkout', {
      title: 'Оформление заказа',
      cart: cart,
      total: total,
      errors: errors,
      old: { name, phone, address }
    });
  }

  const date = new Date().toLocaleString('ru-RU');

  const insert = db.prepare('INSERT INTO orders (name, phone, address, items, total, date) VALUES (?, ?, ?, ?, ?, ?)');
  const result = insert.run(name.trim(), phone.trim(), address.trim(), JSON.stringify(cart), total, date);

  const order = {
    id: result.lastInsertRowid,
    name: name.trim(),
    phone: phone.trim(),
    address: address.trim(),
    items: cart,
    total: total,
    date: date
  };

  req.session.cart = [];

  res.render('order-success', { title: 'Заказ принят', order: order });
});

// Админ-панель: список заказов
app.get('/admin/orders', (req, res) => {
  const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();

  const orders = rows.map(row => ({
    ...row,
    items: JSON.parse(row.items)
  }));

  res.render('admin-orders', { title: 'Заказы', orders: orders });
});

// Изменить статус заказа
app.post('/admin/orders/:id/status', (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.redirect('/admin/orders');
});

// Удалить заказ
app.post('/admin/orders/:id/delete', (req, res) => {
  db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  res.redirect('/admin/orders');
}); 

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});