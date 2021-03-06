const settings = require('./settings.json');
const express = require('express');
const app = express()
const cookie_parser = require('cookie-parser')

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookie_parser())

const http = require('http')
const server = http.createServer(app)
const {Server} = require('socket.io')
const io = new Server(server)


const utilities = require('./utilities')


app.all(/.*/, (req, res, next) => {
    let time = utilities.now()
    time = time.substring(time.indexOf(' '))
    io.of('/debug').emit('log', `${time} ${req.method} ${req.url}`)
    next()
})

const email = require('./email')
const db = require('./database')
app.get('/test', async (req, res, next) => {
    email.send("eduardasvitkus@outlook.com", "Death", "Is impending")
    res.send('Done')
})

app.get('/meeting/chat', (req, res) => {
    res.sendFile(__dirname + '/socket_io/client/meeting_chat.html');
});
app.get('/error', (req, res) => {
    res.sendFile(__dirname + '/socket_io/client/error.html');
});
app.get('/debug', (req, res) => {
    res.sendFile(__dirname + '/socket_io/client/debug.html');
});
app.get('/notification', (req, res) => {
    res.sendFile(__dirname + '/socket_io/client/notification.html');
});

io.of('/error').on('connection', (socket) => {

})
io.of('/debug').on('connection', (socket) => {

})

io.of('/notification').use(async (socket, next) => {
    const cookie = socket.handshake.auth.cookie;
    let result = await db.query(`select * from cookies where cookie = '${cookie}'`)
    if(result.length !== 1) {
        console.log("no account")
        return next(new Error('Account not found!'))
    }
    socket.account = result[0].fk_account
    next();
});
io.of('/notification').on('connection', (socket) => {
})


io.of('/meeting/chat').on('connection', (socket) => {
    io.of('/meeting/chat').to(socket.id).emit('response', {method: `connection`, status: 200})
    socket.logged_rooms = {}
    socket.on('test', (data) => {
        io.of('/meeting/chat').to(socket.id).emit('response', {method: `test`, status: 200})
    })
    socket.on('join', async (data) => {
        let test = utilities.structure_test(data, ['execution_id', 'cookie'])
        if(test) return io.of('/meeting/chat').to(socket.id).emit('response', {method: `join`, status: 400, error: `Body for ${test} undefined!`})
        // Find auth cookie
        let result = await db.query(`select * from cookies where cookie = '${data.cookie}'`)
        if(result.length !== 1) return io.of('/meeting/chat').to(socket.id).emit('response', {method: `join`, status: 404, error: `User not found!`})
        // Get profile
        result = await db.query(`select * from profile where id = '${result[0].fk_account}'`)
        let user = result[0]
        // Check if account has access to meetings chat
        result = await db.query(`select * from execution where id = '${data.execution_id}' and fk_account = '${user.id}'`)
        if(result.length !== 1) {
            result = await db.query(`select * from participant where fk_account = '${user.id}' and fk_execution = '${data.execution_id}'`)
            if(result.length !== 1) return io.of('/meeting/chat').to(socket.id).emit('response', {method: 'join', status: 405, error: `Account is not attending this meeting!`})
        }
        socket.logged_rooms[data.execution_id] = {user: user, auth: data.cookie}
        socket.join(data.execution_id)
        socket.to(data.execution_id).emit('user_joined', user)
        return io.of('/meeting/chat').to(socket.id).emit('response', {method: 'join', status: 200})
    })
    socket.on('message',  async (data) => {
        let test = utilities.structure_test(data, ['execution_id', 'message'])
        if(test) return io.of('/meeting/chat').to(socket.id).emit('response', {method: `message`, status: 400, error: `Body for ${test} undefined!`})
        if(socket.rooms.has(data.execution_id)) {
            socket.to(data.execution_id).emit('message', {
                user: socket.logged_rooms[data.execution_id].user,
                message: data.message
            })
            await db.query(`insert into execution_message(content, fk_account, fk_meeting) value ('${data.message}', '${socket.logged_rooms[data.execution_id].user.id}', '${data.execution_id}')`)
        }
        else {
            return io.of('/meeting/chat').to(socket.id).emit('response', {method: 'message', status: 401, error: 'User has not joined this meeting'})
        }
        return io.of('/meeting/chat').to(socket.id).emit('response', {method: 'message', status: 200})
    })
    socket.on('start_typing', (data) => {
        let test = utilities.structure_test(data, ['execution_id'])
        if(test) return io.of('/meeting/chat').to(socket.id).emit('response', {method: `start_typing`, status: 400, error: `Body for ${test} undefined!`})
        if(socket.rooms.has(data.execution_id)) {
            socket.to(data.execution_id).emit('start_typing', socket.logged_rooms[data.execution_id].user)
            return io.of('/meeting/chat').to(socket.id).emit('response', {method: 'start_typing', status: 200})
        }
        else {
            return io.of('/meeting/chat').to(socket.id).emit('response', {method: 'start_typing', status: 401, error: 'User has not joined this meeting'})
        }
    })
    socket.on('end_typing', (data) => {
        let test = utilities.structure_test(data, ['execution_id'])
        if(test) return io.of('/meeting/chat').to(socket.id).emit('response', {method: `end_typing`, status: 400, error: `Body for ${test} undefined!`})
        if(socket.rooms.has(data.execution_id)) {
            socket.to(data.execution_id).emit('end_typing', socket.logged_rooms[data.execution_id].user)
            return io.of('/meeting/chat').to(socket.id).emit('response', {method: 'end_typing', status: 200})
        }
        else {
            return io.of('/meeting/chat').to(socket.id).emit('response', {method: 'end_typing', status: 401, error: 'User has not joined this meeting'})
        }
    })
    socket.on('leave', (data) => {
        let test = utilities.structure_test(data, ['execution_id'])
        if(test) return io.of('/meeting/chat').to(socket.id).emit('response', {method: `leave`, status: 400, error: `Body for ${test} undefined!`})
        if(socket.rooms.has(data.execution_id)) {
            let user = socket.logged_rooms[data.execution_id]
            socket.logged_rooms[data.execution_id] = undefined
            socket.leave(data.execution_id)
            socket.to(data.execution_id).emit('user_left', user)
        }
        else return io.of('/meeting/chat').to(socket.id).emit('response', {method: 'leave', status: 401, error: 'User has not joined this meeting'})
        return io.of('/meeting/chat').to(socket.id).emit('response', {method: 'leave', status: 200})
    })
})

app.use('/public', require('./route/public'))
app.use('/profile', require('./route/profile'))
app.use('/challenge', require('./route/challenge'))
app.use('/execution', require('./route/execution'))
app.use('/meeting', require('./route/meeting'))
app.use('/bookmark', require('./route/bookmark'))
app.use('/resource', require('./route/resource'))
app.use('/notification', require('./route/notification'))
app.use('/claim', require('./route/claim'))
app.use('/post', require('./route/post'))

app.all(/.*/, (req, res) => {
    return res.status(404).send('Route not found!')
})

server.listen(settings.server.port, () => {
    console.log(`Server running on: localhost:${settings.server.port}`)
})

module.exports = {
    io,
    app,
    server
}