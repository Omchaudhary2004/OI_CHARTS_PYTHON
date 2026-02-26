const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(dbPath);

console.log('Checking database tables...\n');

db.all(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
  (err, rows) => {
    if (err) {
      console.error('Error querying tables:', err);
      db.close();
      return;
    }

    console.log('Tables in database:');
    if (!rows || rows.length === 0) {
      console.log('  (no tables found)');
    } else {
      rows.forEach(row => {
        console.log(`  ✓ ${row.name}`);
      });
    }

    // Check metadata table content
    console.log('\nMetadata table content:');
    db.all('SELECT * FROM metadata', (err, rows) => {
      if (err) {
        console.error('  Error querying metadata:', err.message);
      } else {
        if (!rows || rows.length === 0) {
          console.log('  (empty)');
        } else {
          rows.forEach(row => {
            console.log(`  ${row.key}: "${row.value}"`);
          });
        }
      }

      db.close();
      console.log('\n✓ Database check complete!');
    });
  }
);
