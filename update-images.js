const db = require('./db');

const images = {
  'Парацетамол 500мг': 'https://placehold.co/400x300/e8f4f8/333?text=Парацетамол',
  'Ибупрофен 400мг': 'https://placehold.co/400x300/f8e8e8/333?text=Ибупрофен',
  'Витамин C': 'https://placehold.co/400x300/fff8e8/333?text=Витамин+C'
};

const update = db.prepare('UPDATE products SET image = ? WHERE name = ?');

for (const [name, url] of Object.entries(images)) {
  update.run(url, name);
}

console.log('Картинки обновлены');