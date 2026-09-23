export default function handler(req, res) {
  res.status(200).json({
    message: 'Catch-all API function working!',
    path: req.url,
    method: req.method,
    timestamp: new Date().toISOString()
  });
} 