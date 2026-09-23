# AGENTS.md

## Commands
- Frontend: `cd frontend && npm run dev/build/preview`
- Backend: `cd backend && node server.js`
- No lint/test commands found

## Code Style
- **Frontend**: React 18, Vite, JSX components
- **Backend**: Node.js, Express, CommonJS (`require`)
- **Naming**: camelCase for variables/functions, PascalCase for React components
- **Imports**: Use `require()` for backend, `import` for frontend
- **Error handling**: Try/catch with console.log for errors
- **Formatting**: Standard JS style, 2-space indentation
- **Environment**: Use `.env` files, never commit secrets
- **API**: RESTful endpoints with JSON responses