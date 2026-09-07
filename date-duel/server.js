const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

const spots = [
  ['СТАРТ',0], ['Кофейня',120], ['Фото-будка',140], ['WILD',0], ['Кино',160], ['Набережная',180],
  ['FREE PASS',0], ['Книжный',200], ['Плейлист',220], ['WILD',0], ['Бар без алкоголя',240], ['Терраса',260],
  ['СТАРТ',0], ['Парк',280], ['Десертная',300], ['WILD',0], ['Танцпол',320], ['Музей ночью',340],
  ['FREE PASS',0], ['Смотровая',360], ['Гостиничный лобби',380], ['WILD',0], ['Пентхаус',420], ['Рассвет',450]
];

const challenges = {
  romantic: [
    'Назови три вещи, за которые ты особенно ценишь партнёра.',
    'Вспомните момент, когда вы оба смеялись до слёз. Расскажите его по очереди.',
    'Сделайте друг другу комплимент, который касается не внешности.',
    'Выберите песню, которая могла бы быть саундтреком ваших отношений.',
    '30 секунд держитесь за руки и смотрите друг другу в глаза — без разговоров.',
    'Скажите, какое совместное маленькое приключение вы хотите устроить в ближайший месяц.'
  ],
  flirty: [
    'Шепни партнёру на ухо самый дерзкий комплимент, который тебе приходит в голову.',
    'Пусть партнёр выберет: медленный танец на 45 секунд или 3 поцелуя.',
    'Назови три детали во внешности партнёра, которые тебе особенно нравятся.',
    'Сыграйте в молчанку 30 секунд: можно только флиртовать жестами.',
    'Партнёр выбирает место для поцелуя: лоб, щека или губы.',
    'Придумай партнёру новое кокетливое прозвище до конца следующего круга.'
  ],
  after: [
    'Партнёр выбирает: минутный массаж плеч или серия из пяти поцелуев.',
    'Скажи, что в поведении партнёра кажется тебе особенно притягательным.',
    'Сядьте ближе друг к другу до следующего хода.',
    'Партнёр выбирает песню, под которую вы танцуете максимально близко 45 секунд.',
    'Расскажи одну фантазию про идеальное свидание — настолько смело, насколько вам обоим комфортно.',
    'Выберите: долгий поцелуй или минутный массаж рук.'
  ]
};

const wildcards = [
  { text: 'Счастливая случайность: получи 100 монет.', effect: s => s.money += 100 },
  { text: 'Щедрый жест: отдай партнёру 75 монет.', pair: true },
  { text: 'Ускорение: переместись на 3 клетки вперёд.', move: 3 },
  { text: 'Пауза: получи Free Pass.', pass: 1 },
  { text: 'Ностальгия: вернись на 2 клетки назад.', move: -2 },
  { text: 'Джекпот вечера: получи 2 искры.', spark: 2 }
];

function newRoom(code, hostName) {
  return {
    code,
    phase: 'lobby',
    mode: 'romantic',
    chapter: 0,
    maxChapters: 16,
    turn: 0,
    players: [{ id: null, name: hostName, pos: 0, money: 1000, spark: 0, passes: 0, owned: [] }],
    ownership: {},
    pending: null,
    log: [`Комната ${code} создана.`]
  };
}

function roomPublic(room) {
  return JSON.parse(JSON.stringify(room));
}
function emit(room) { io.to(room.code).emit('state', roomPublic(room)); }
function genCode() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c=''; do { c=''; for(let i=0;i<5;i++) c+=chars[Math.floor(Math.random()*chars.length)]; } while(rooms.has(c));
  return c;
}
function playerIndex(room, socketId) { return room.players.findIndex(p=>p.id===socketId); }

io.on('connection', socket => {
  socket.on('createRoom', ({name}) => {
    const code=genCode(); const room=newRoom(code, (name||'Игрок 1').slice(0,20));
    room.players[0].id=socket.id; rooms.set(code, room); socket.join(code); socket.data.room=code; emit(room);
  });
  socket.on('joinRoom', ({code,name}) => {
    code=(code||'').toUpperCase().trim(); const room=rooms.get(code);
    if(!room) return socket.emit('errorMsg','Комната не найдена');
    if(room.players.length>=2) return socket.emit('errorMsg','В комнате уже два игрока');
    room.players.push({id:socket.id,name:(name||'Игрок 2').slice(0,20),pos:0,money:1000,spark:0,passes:0,owned:[]});
    socket.join(code); socket.data.room=code; room.log.push(`${room.players[1].name} присоединился.`); emit(room);
  });
  socket.on('setMode', mode => {
    const room=rooms.get(socket.data.room); if(!room||room.phase!=='lobby') return;
    if(['romantic','flirty','after'].includes(mode)) { room.mode=mode; emit(room); }
  });
  socket.on('startGame', () => {
    const room=rooms.get(socket.data.room); if(!room||room.players.length<2||room.phase!=='lobby') return;
    if(playerIndex(room,socket.id)!==0) return;
    room.phase='game'; room.log.push('Игра началась. Бросайте кубик!'); emit(room);
  });
  socket.on('roll', () => {
    const room=rooms.get(socket.data.room); if(!room||room.phase!=='game'||room.pending) return;
    const pi=playerIndex(room,socket.id); if(pi!==room.turn) return;
    const p=room.players[pi]; const roll=1+Math.floor(Math.random()*6); const old=p.pos; p.pos=(p.pos+roll)%spots.length;
    if(p.pos<old){p.money+=75; room.log.push(`${p.name} прошёл круг и получил 75.`)}
    const [name,price]=spots[p.pos]; room.log.push(`${p.name} выбросил ${roll} и попал на «${name}».`);
    if(name==='FREE PASS'){p.passes++; room.pending={type:'info',player:pi,text:'Ты получил Free Pass.',roll};}
    else if(name==='WILD'){
      const w=wildcards[Math.floor(Math.random()*wildcards.length)];
      if(w.effect) w.effect(p); if(w.move) p.pos=(p.pos+w.move+spots.length)%spots.length; if(w.pass) p.passes+=w.pass; if(w.spark)p.spark+=w.spark;
      if(w.pair){const other=room.players[1-pi]; const amt=Math.min(75,p.money); p.money-=amt; other.money+=amt;}
      room.pending={type:'info',player:pi,text:w.text,roll};
    } else if(name==='СТАРТ') room.pending={type:'info',player:pi,text:'Спокойная клетка. Передай ход.',roll};
    else {
      const owner=room.ownership[p.pos];
      if(owner===undefined) room.pending={type:'buy',player:pi,spot:p.pos,price,roll};
      else if(owner===pi) room.pending={type:'info',player:pi,text:'Это твоё место. Отдыхай и передавай ход.',roll};
      else room.pending={type:'challengeChoice',player:pi,owner,spot:p.pos,price,roll};
    }
    emit(room);
  });
  socket.on('buyDecision', ({buy}) => {
    const room=rooms.get(socket.data.room); if(!room||!room.pending||room.pending.type!=='buy') return;
    const pi=playerIndex(room,socket.id); if(pi!==room.pending.player) return; const p=room.players[pi]; const {spot,price}=room.pending;
    if(buy && p.money>=price){p.money-=price; room.ownership[spot]=pi; p.owned.push(spot); room.log.push(`${p.name} купил «${spots[spot][0]}» за ${price}.`);
      const text=challenges[room.mode][Math.floor(Math.random()*challenges[room.mode].length)]; room.pending={type:'challenge',player:1-pi,source:pi,level:'base',text,cost:0,spark:0};
    } else {room.log.push(`${p.name} не стал покупать «${spots[spot][0]}».`); room.pending=null; advance(room);}
    checkEnd(room); emit(room);
  });
  socket.on('challengeLevel', ({level}) => {
    const room=rooms.get(socket.data.room); if(!room||!room.pending||room.pending.type!=='challengeChoice') return;
    const pi=playerIndex(room,socket.id); if(pi!==room.pending.player) return; const p=room.players[pi];
    const base=Math.max(40,Math.round(room.pending.price*.45));
    const mult=level==='base'?1:level==='tease'?.5:level==='bold'?.25:0;
    if(level==='pass'&&p.passes<=0) return;
    let cost=Math.round(base*mult); let spark=level==='tease'?1:level==='bold'?2:0;
    if(level==='pass'){p.passes--; room.pending=null; room.log.push(`${p.name} использовал Free Pass.`); advance(room); return emit(room);}
    cost=Math.min(cost,p.money); p.money-=cost; room.players[room.pending.owner].money+=cost; p.spark+=spark;
    const text=challenges[room.mode][Math.floor(Math.random()*challenges[room.mode].length)];
    room.pending={type:'challenge',player:pi,source:room.pending.owner,level,text,cost,spark}; emit(room);
  });
  socket.on('challengeDone', ({skip}) => {
    const room=rooms.get(socket.data.room); if(!room||!room.pending||room.pending.type!=='challenge') return;
    const pi=playerIndex(room,socket.id); if(pi!==room.pending.player) return; const p=room.players[pi];
    if(skip){ const fee=Math.min(room.pending.level==='bold'?120:60,p.money); p.money-=fee; room.players[1-pi].money+=fee; room.log.push(`${p.name} пропустил за ${fee}.`); }
    else room.log.push(`${p.name} выполнил задание ✨`);
    room.chapter++; room.pending=null; checkEnd(room); if(room.phase==='game') advance(room); emit(room);
  });
  socket.on('ack',()=>{const room=rooms.get(socket.data.room); if(!room||!room.pending||room.pending.type!=='info') return; if(playerIndex(room,socket.id)!==room.pending.player)return; room.pending=null; advance(room); emit(room);});
  socket.on('disconnect',()=>{
    const room=rooms.get(socket.data.room); if(!room)return; const i=playerIndex(room,socket.id); if(i>=0){room.log.push(`${room.players[i].name} отключился.`); emit(room);} });
});

function advance(room){ room.turn=1-room.turn; }
function checkEnd(room){
  if(room.chapter<room.maxChapters) return;
  room.phase='ended'; room.pending=null;
  const worth=room.players.map(p=>p.money+p.owned.reduce((s,i)=>s+spots[i][1],0));
  const greedy=worth[0]===worth[1]?'Ничья':room.players[worth[0]>worth[1]?0:1].name;
  const sparks=room.players.map(p=>p.spark); const passionate=sparks[0]===sparks[1]?'Ничья':room.players[sparks[0]>sparks[1]?0:1].name;
  room.result={worth,greedy,passionate}; room.log.push('Финальная глава завершена!');
}

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Date Duel: http://localhost:${PORT}`));
