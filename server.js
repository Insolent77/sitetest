const express = require('express');
const session = require('express-session');
const https = require('https');
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

// Получить JSON по URL (для oEmbed Vimeo/RuTube)
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Хелпер: получить информацию для встраивания видео + превью
async function getEmbedInfo(url) {
  try {
    // YouTube (обычные ссылки, youtu.be и Shorts)
    let m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/);
    if (m) {
      return {
        embedUrl: `https://www.youtube.com/embed/${m[1]}`,
        embeddable: true,
        type: 'youtube',
        thumbnail: `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`
      };
    }

    // Vimeo
    m = url.match(/vimeo\.com\/(\d+)/);
    if (m) {
      let thumbnail = null;
      try {
        const data = await fetchJson(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);
        thumbnail = data.thumbnail_url || null;
      } catch (e) { /* без превью */ }
      return {
        embedUrl: `https://player.vimeo.com/video/${m[1]}`,
        embeddable: true,
        type: 'vimeo',
        thumbnail: thumbnail
      };
    }

    // VK / VK Video — embed блокируется, превью недоступно без VK API
    m = url.match(/(?:vk\.com|vkvideo\.ru)\/video(-?\d+)_(\d+)/);
    if (m) {
      return { embedUrl: url, embeddable: false, type: 'vk', thumbnail: null };
    }

    // RuTube
    m = url.match(/rutube\.ru\/video\/([a-f0-9]+)/);
    if (m) {
      let thumbnail = null;
      try {
        const data = await fetchJson(`https://rutube.ru/api/oembed/?url=${encodeURIComponent(url)}&format=json`);
        thumbnail = data.thumbnail_url || null;
      } catch (e) { /* без превью */ }
      return {
        embedUrl: `https://rutube.ru/play/embed/${m[1]}`,
        embeddable: true,
        type: 'rutube',
        thumbnail: thumbnail
      };
    }

    // Прочие ссылки
    return { embedUrl: url, embeddable: false, type: 'other', thumbnail: null };
  } catch (e) {
    return { embedUrl: url, embeddable: false, type: 'other', thumbnail: null };
  }
}

// Страница избранного
app.get('/favorites', async (req, res) => {
  const favorites = db.prepare('SELECT * FROM favorites ORDER BY id DESC').all();
  const favoritesWithEmbed = await Promise.all(
    favorites.map(async (f) => ({
      ...f,
      ...(await getEmbedInfo(f.url))
    }))
  );
  res.render('favorites', { title: 'Избранное', favorites: favoritesWithEmbed });
});

// Добавить видео в избранное
app.post('/favorites/add', (req, res) => {
  const { url, title } = req.body;

  if (!url || !url.trim()) {
    return res.redirect('/favorites');
  }

  const date = new Date().toLocaleString('ru-RU');
  db.prepare('INSERT INTO favorites (url, title, date) VALUES (?, ?, ?)')
    .run(url.trim(), (title || '').trim(), date);

  res.redirect('/favorites');
});

// Удалить видео из избранного
app.post('/favorites/:id/delete', (req, res) => {
  db.prepare('DELETE FROM favorites WHERE id = ?').run(req.params.id);
  res.redirect('/favorites');
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});