"use strict";

var privileges = {};

require('./privileges/categories')(privileges);
require('./privileges/topics')(privileges);
require('./privileges/posts')(privileges);
require('./privileges/votes')(privileges);

module.exports = privileges;