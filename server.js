const opn = require('opn')
const express = require('express');
let app = express();

app.use(express.static('public'));

app.listen(3333, () => {
  opn('http://127.0.0.1:3333');
});


