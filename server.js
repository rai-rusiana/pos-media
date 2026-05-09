const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Enable CORS for browser-based clients and allow preflight requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json());

// Validate environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allowed file types
    const allowedMimeTypes = [
      // Images
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',

      // Videos
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-ms-wmv',

      // Documents
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',

      // Text files
      'text/plain',
      'text/csv',

      // Archives (if needed)
      // 'application/zip',
      // 'application/x-rar-compressed'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed. Please upload images, videos, documents, or text files.'), false);
    }
  }
});

// Helper function to generate consistent JSON responses
const sendResponse = (res, success, data = null, error = null) => {
  const response = { success };
  if (data !== null) response.data = data;
  if (error !== null) response.error = error;
  res.json(response);
};

// Health check endpoint
app.get('/health', (req, res) => {
  sendResponse(res, true, { message: 'Media server is running' });
});

// Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    // Validate required fields
    if (process.env.NODE_ENV === 'development') {
      console.log('Received upload request with body:', req.body);
      console.log('Received file:', req.file);
    }
    if (!req.file) {
      return sendResponse(res, false, null, 'No file provided');
    }

    if (!req.body.orgId) {
      return sendResponse(res, false, null, 'orgId is required');
    }

    const orgId = req.body.orgId;
    const file = req.file;

    // Generate unique filename with preserved extension
    const ext = mime.extension(file.mimetype) || '';
    const filename = `${uuidv4()}${ext ? '.' + ext : ''}`;
    const filePath = `orgs/${orgId}/${filename}`;

    // Upload to Supabase Storage
    const { data, error: uploadError } = await supabase
      .storage
      .from('media')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Supabase upload error details:', {
          message: uploadError.message,
          status: uploadError.status,
          response: uploadError.response
        });
      }
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = supabase
      .storage
      .from('media')
      .getPublicUrl(filePath);

    sendResponse(res, true, {
      publicUrl: urlData.publicUrl,
      filePath: filePath
    });
  } catch (error) {
    console.error('Upload error:', error);
    sendResponse(res, false, null, error.message || 'Internal server error');
  }
});

// Delete endpoint
app.delete('/delete', express.json(), async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'development') {
      console.log('Received delete request with body:', req.body);
    }
    const { path } = req.body;


    if (!path) {
      return sendResponse(res, false, null, 'path is required');
    }

    // Delete file from Supabase Storage
    const { error: deleteError } = await supabase
      .storage
      .from('media')
      .remove([path]);

    if (deleteError) {
      throw deleteError;
    }

    sendResponse(res, true, { message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    sendResponse(res, false, null, error.message || 'Internal server error');
  }
});

// Update endpoint
app.put('/update', upload.single('file'), async (req, res) => {
  try {
    // Validate required fields
    if (process.env.NODE_ENV === 'development') {
      console.log('Received update request with body:', req.body);
      console.log('Received file:', req.file);
    }

    if (!req.file) {
      return sendResponse(res, false, null, 'No file provided');
    }

    if (!req.body.oldPath) {
      return sendResponse(res, false, null, 'oldPath is required');
    }

    if (!req.body.orgId) {
      return sendResponse(res, false, null, 'orgId is required');
    }

    const oldPath = req.body.oldPath;
    const orgId = req.body.orgId;
    const file = req.file;

    // Delete old file
    const { error: deleteError } = await supabase
      .storage
      .from('media')
      .remove([oldPath]);

    if (deleteError) {
      throw deleteError;
    }

    // Generate unique filename with preserved extension
    const ext = mime.extension(file.mimetype) || '';
    const filename = `${uuidv4()}${ext ? '.' + ext : ''}`;
    const newFilePath = `orgs/${orgId}/${filename}`;

    // Upload new file to Supabase Storage
    const { data, error: uploadError } = await supabase
      .storage
      .from('media')
      .upload(newFilePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) {
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = supabase
      .storage
      .from('media')
      .getPublicUrl(newFilePath);

    sendResponse(res, true, {
      publicUrl: urlData.publicUrl,
      filePath: newFilePath
    });
  } catch (error) {
    console.error('Update error:', error);
    sendResponse(res, false, null, error.message || 'Internal server error');
  }
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return sendResponse(res, false, null, 'File size exceeds 5MB limit');
    }
    return sendResponse(res, false, null, error.message);
  }

  if (error) {
    return sendResponse(res, false, null, error.message);
  }

  next();
});

// 404 handler
app.use((req, res) => {
  sendResponse(res, false, null, 'Endpoint not found');
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Media server running on port ${port}`);
});

module.exports = app;
// ssh -R 80:localhost:3001 nokey@localhost.run 