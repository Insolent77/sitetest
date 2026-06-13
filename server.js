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

    // VK / VK Video — embed блокируется VK без hash, открываем в новой вкладке
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
      ...(await getEmbedInfo(f.url)),
      comments: db.prepare('SELECT * FROM comments WHERE favorite_id = ? ORDER BY id ASC').all(f.id)
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

// Добавить комментарий к видео
app.post('/favorites/:id/comments/add', (req, res) => {
  const { author, text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Текст обязателен' });
  }

  const date = new Date().toLocaleString('ru-RU');
  const result = db.prepare('INSERT INTO comments (favorite_id, author, text, date) VALUES (?, ?, ?, ?)')
    .run(req.params.id, (author || 'Гость').trim(), text.trim(), date);

  res.json({
    id: result.lastInsertRowid,
    author: (author || 'Гость').trim(),
    text: text.trim(),
    date: date
  });
});

// Удалить комментарий
app.post('/comments/:id/delete', (req, res) => {
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// === Страница преподавателя: управление слотами ===
app.get('/teacher', (req, res) => {
  const slots = db.prepare('SELECT * FROM slots ORDER BY date ASC, time ASC').all();
  const newBookings = db.prepare('SELECT COUNT(*) AS count FROM slots WHERE status = ? AND seen = 0').get('booked').count;
  res.render('teacher', { title: 'Кабинет преподавателя', slots: slots, newBookings: newBookings });
});

// Добавить новый свободный слот
app.post('/teacher/slots/add', (req, res) => {
  const { date, time } = req.body;
  if (date && time) {
    db.prepare('INSERT INTO slots (date, time, status) VALUES (?, ?, ?)').run(date, time, 'free');
  }
  res.redirect('/teacher');
});

// Удалить слот
app.post('/teacher/slots/:id/delete', (req, res) => {
  db.prepare('DELETE FROM slots WHERE id = ?').run(req.params.id);
  res.redirect('/teacher');
});

// Отметить бронь как просмотренную
app.post('/teacher/slots/:id/seen', (req, res) => {
  db.prepare('UPDATE slots SET seen = 1 WHERE id = ?').run(req.params.id);
  res.redirect('/teacher');
});

// Освободить забронированный слот (отменить запись)
app.post('/teacher/slots/:id/free', (req, res) => {
  db.prepare('UPDATE slots SET status = ?, student_name = NULL, student_contact = NULL, seen = 1 WHERE id = ?')
    .run('free', req.params.id);
  res.redirect('/teacher');
});

// === Страница для родителей/учеников: запись ===
app.get('/booking', (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || (now.getMonth() + 1); // 1-12

  const slots = db.prepare("SELECT * FROM slots WHERE status = 'free' AND date >= date('now') ORDER BY date ASC, time ASC").all();

  // Группируем слоты по дате
  const grouped = {};
  slots.forEach(slot => {
    if (!grouped[slot.date]) grouped[slot.date] = [];
    grouped[slot.date].push(slot);
  });

  // Строим сетку календаря для выбранного месяца
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();

  // День недели первого числа (0 = вс, 1 = пн... переводим на пн=0)
  let startWeekday = firstDay.getDay();
  startWeekday = startWeekday === 0 ? 6 : startWeekday - 1;

  const calendarDays = [];

  // Пустые ячейки перед первым числом
  for (let i = 0; i < startWeekday; i++) {
    calendarDays.push(null);
  }

  // Дни месяца
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    calendarDays.push({
      day: d,
      date: dateStr,
      slots: grouped[dateStr] || []
    });
  }

  // Навигация по месяцам
  let prevMonth = month - 1, prevYear = year;
  if (prevMonth === 0) { prevMonth = 12; prevYear--; }
  let nextMonth = month + 1, nextYear = year;
  if (nextMonth === 13) { nextMonth = 1; nextYear++; }

  const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  res.render('booking', {
    title: 'Запись на занятие',
    calendarDays: calendarDays,
    monthName: monthNames[month - 1],
    year: year,
    prevMonth, prevYear, nextMonth, nextYear
  });
});

// Забронировать слот
app.post('/booking/:id', (req, res) => {
  const { student_name, student_contact } = req.body;

  if (!student_name || !student_name.trim() || !student_contact || !student_contact.trim()) {
    return res.redirect('/booking');
  }

  const slot = db.prepare('SELECT * FROM slots WHERE id = ? AND status = ?').get(req.params.id, 'free');
  if (!slot) {
    return res.redirect('/booking');
  }

  db.prepare('UPDATE slots SET status = ?, student_name = ?, student_contact = ?, seen = 0 WHERE id = ?')
    .run('booked', student_name.trim(), student_contact.trim(), req.params.id);

  res.render('booking-success', { title: 'Запись подтверждена', slot: slot, student_name: student_name.trim() });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});