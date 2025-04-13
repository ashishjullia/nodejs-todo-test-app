const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const fs = require('fs');
const { Signer } = require('@aws-sdk/rds-signer');
const session = require('express-session');

const app = express();
const port = process.env.PORT || 80;

const APP_PASSWORD = process.env.APP_PASSWORD || "example";

const dbConfig = {
    host: process.env.RDS_HOSTNAME,
    port: parseInt(process.env.RDS_PORT || '5432', 10),
    user: process.env.RDS_IAM_USER, 
    database: process.env.RDS_DB_NAME,
    region: process.env.AWS_REGION
};
console.log("Database Configuration:", dbConfig);
if (!dbConfig.host || !dbConfig.user || !dbConfig.database || !dbConfig.region) { /* ... */ process.exit(1); }

const rdsCaBundlePath = process.env.RDS_CA_BUNDLE_PATH || path.join(__dirname, 'ap-south-1-bundle.pem');
let sslConfig = { rejectUnauthorized: true };
try {
    if (fs.existsSync(rdsCaBundlePath)) {
        console.log(`[Info] Loading RDS CA bundle from: ${rdsCaBundlePath}`);
        sslConfig.ca = fs.readFileSync(rdsCaBundlePath).toString();
    } else {
        console.error(`[Error] RDS CA bundle not found at: ${rdsCaBundlePath}`);
        console.error('[Error] IAM authentication will likely fail without the correct CA bundle.');
        process.exit(1);
    }
} catch (err) {
    console.error(`[Error] Failed to read RDS CA bundle from ${rdsCaBundlePath}:`, err);
    process.exit(1);
}

console.log('[Info] Creating RDS Signer...');
const signer = new Signer({
    hostname: dbConfig.host,
    port: dbConfig.port,
    username: dbConfig.user,
    region: dbConfig.region,
});
console.log('[Info] RDS Signer created.');

console.log('[Info] Configuring database pool for manual IAM token usage...');
const pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    database: dbConfig.database,
    ssl: sslConfig,             // Apply SSL configuration (CA bundle is crucial)

    password: async () => {
        try {
            console.log('[Info] Pool requesting new connection: Generating IAM auth token...');
            const token = await signer.getAuthToken();
            console.log('[Info] IAM auth token generated successfully.');
            return token;
        } catch (err) {
            console.error('[Error] Failed to generate IAM auth token:', err.message || err);
            throw new Error(`Failed to obtain IAM auth token: ${err.message}`);
        }
    },
});

pool.on('connect', (client) => {
    console.log('[Info] Database pool successfully connected a client using IAM token.');
});
pool.on('error', (err, client) => {
    console.error('[Error] Unexpected error on idle database client:', err.message || err);
    process.exit(1); 
});

async function setupDatabase() {
    let client;
    try {
        console.log('[Info] Attempting to connect to database for setup (using manual IAM token)...');
        client = await pool.connect(); 
        console.log('[Info] Connected to database via pool. Setting up schema...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS todos (
                id SERIAL PRIMARY KEY,
                text VARCHAR(255) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('[Success] Table "todos" is ready.');
    } catch (err) {
        console.error('[Error] Error setting up database table:', err.message || err);
        throw err;
    } finally {
        if (client) {
            client.release();
            console.log('[Info] Database client released after setup.');
        }
    }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SESSION_SECRET = process.env.SESSION_SECRET || 'a-weak-default-secret-change-me!';
if (SESSION_SECRET === 'a-weak-default-secret-change-me!' && process.env.NODE_ENV === 'production') {
    console.warn('[SECURITY WARNING] Using default session secret in production!');
}
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24
    }
}));

app.get('/login', (req, res) => {
    if (req.session.isAuthenticated) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
    const { password } = req.body;

    if (password === APP_PASSWORD) {
        req.session.isAuthenticated = true;
        req.session.save(err => {
            if (err) {
                console.error("Session save error:", err);
                return res.status(500).send("Login failed due to server error.");
            }
            console.log("[Auth] User authenticated successfully.");
            res.redirect('/');
        });
    } else {
        console.log("[Auth] Failed login attempt.");
        res.status(401).send(`
            Login Failed. <a href="/login">Try again</a>
            <script>
                setTimeout(() => { window.location.href = '/login'; }, 2000); // Redirect back after 2s
            </script>
        `);
    }
});

app.get('/logout', (req, res, next) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Logout error:", err);
            return next(err);
        }
        res.redirect('/login');
    });
});

app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).json({ status: 'OK', message: 'Database connection healthy.' });
    } catch (err) {
        console.error('[Error] Health Check Failed:', err.message || err);
        res.status(503).json({ status: 'Error', message: 'Database connection unhealthy.' });
    }
});

function requireAuth(req, res, next) {
    if (req.session.isAuthenticated) {
        next();
    } else {
        console.log(`[Auth] Unauthorized access attempt to ${req.originalUrl}. Redirecting to login.`);
        res.redirect('/login');
    }
}
app.use(requireAuth);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/todos', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, text, created_at FROM todos ORDER BY created_at DESC'
        );
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('[Error] API - Error fetching todos:', err.message || err);
        res.status(500).json({ message: 'Failed to fetch todos due to a server error.' });
    }
});

app.post('/add-todo', async (req, res) => {
    const { todoText } = req.body;
    if (!todoText || typeof todoText !== 'string' || todoText.trim() === '') {
         return res.status(400).json({ message: 'Todo text cannot be empty.' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO todos (text) VALUES ($1) RETURNING id, text, created_at',
            [todoText.trim()]
        );
        res.status(201).json({ message: 'Todo added successfully!', todo: result.rows[0] });
    } catch (err) {
        console.error('[Error] API - Error inserting todo:', err.message || err);
        res.status(500).json({ message: 'Failed to save todo due to a server error.' });
    }
});

const gracefulShutdown = async (signal) => {
    console.log(`\n[Info] Received ${signal}. Shutting down gracefully...`);
    try {
      await pool.end();
      console.log('[Info] Database pool closed.');
      process.exit(0);
    } catch (err) {
      console.error('[Error] Error closing database pool during shutdown:', err.message || err);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

console.log('[Info] Starting application setup...');
setupDatabase().then(() => {
    const server = app.listen(port, () => {
        console.log(`[Success] Todo app server running using MANUAL IAM Auth Token Generation`);
        console.log(`[Info] Listening at http://localhost:${port}`);
        console.log(`[Info] DB Config: Host=${dbConfig.host}, Port=${dbConfig.port}, User=${dbConfig.user}, DB=${dbConfig.database}, Region=${dbConfig.region}`);
    });
}).catch(err => {
     console.error("[Fatal] Failed to setup database. Server cannot start.", err.message || err);
     console.error(err);
     process.exit(1);
});
