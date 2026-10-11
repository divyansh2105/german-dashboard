import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backupFilePath = path.resolve(__dirname, 'deleted_words_backup.json')
const myListBackupPath = path.resolve(__dirname, 'my_list_backup.json')

function localBackupPlugin() {
  return {
    name: 'local-backup-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlPath = req.url ? req.url.split('?')[0] : ''
        if (urlPath === '/api/backup-deleted') {
          if (req.method === 'POST') {
            let body = ''
            req.on('data', chunk => { body += chunk })
            req.on('end', () => {
              try {
                const list = JSON.parse(body)
                if (Array.isArray(list)) {
                  fs.writeFileSync(backupFilePath, JSON.stringify(list, null, 2), 'utf-8')
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ success: true, count: list.length, path: 'deleted_words_backup.json' }))
                  return
                }
              } catch (err) {
                console.error('Local backup write failed:', err)
              }
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid payload' }))
            })
            return
          } else if (req.method === 'GET') {
            try {
              if (fs.existsSync(backupFilePath)) {
                const content = fs.readFileSync(backupFilePath, 'utf-8')
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(content || '[]')
                return
              }
            } catch (err) {
              console.error('Local backup read failed:', err)
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end('[]')
            return
          }
        }

        if (urlPath === '/api/backup-mylist') {
          if (req.method === 'POST') {
            let body = ''
            req.on('data', chunk => { body += chunk })
            req.on('end', () => {
              try {
                const list = JSON.parse(body)
                if (Array.isArray(list)) {
                  fs.writeFileSync(myListBackupPath, JSON.stringify(list, null, 2), 'utf-8')
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ success: true, count: list.length, path: 'my_list_backup.json' }))
                  return
                }
              } catch (err) {
                console.error('MyList backup write failed:', err)
              }
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid payload' }))
            })
            return
          } else if (req.method === 'GET') {
            try {
              if (fs.existsSync(myListBackupPath)) {
                const content = fs.readFileSync(myListBackupPath, 'utf-8')
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(content || '[]')
                return
              }
            } catch (err) {
              console.error('MyList backup read failed:', err)
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end('[]')
            return
          }
        }

        next()
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localBackupPlugin()],
  server: {
    port: 3111
  }
})

