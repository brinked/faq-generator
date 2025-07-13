# FAQ Generator Frontend

A beautiful, user-friendly React frontend for the FAQ Generator application. This interface provides a step-by-step wizard for connecting email accounts, monitoring processing status, and viewing generated FAQs.

## Features

- **Step-by-Step Wizard**: Intuitive 3-step process for email connection, processing, and FAQ viewing
- **Real-time Progress Tracking**: Live updates during email processing with Socket.IO
- **Beautiful UI**: Modern design with Tailwind CSS and Framer Motion animations
- **Email Integration**: OAuth 2.0 authentication for Gmail and Outlook
- **FAQ Management**: Search, filter, edit, and export generated FAQs
- **Responsive Design**: Works seamlessly on desktop and mobile devices

## Technology Stack

- **React 18**: Modern React with hooks and functional components
- **Tailwind CSS**: Utility-first CSS framework for styling
- **Framer Motion**: Smooth animations and transitions
- **Socket.IO Client**: Real-time communication with backend
- **React Toastify**: Beautiful toast notifications
- **Axios**: HTTP client for API requests

## Getting Started

### Prerequisites

- Node.js 16+ and npm 8+
- Backend API server running (see main README)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
REACT_APP_API_URL=http://localhost:3000
REACT_APP_SOCKET_URL=http://localhost:3000
REACT_APP_GMAIL_CLIENT_ID=your-gmail-client-id
REACT_APP_OUTLOOK_CLIENT_ID=your-outlook-client-id
```

### Development

Start the development server:
```bash
npm start
```

The app will open at `http://localhost:3001` (or next available port).

### Building for Production

Build the optimized production bundle:
```bash
npm run build
```

The build files will be created in the `build/` directory.

## Project Structure

```
client/
├── public/
│   ├── index.html          # HTML template
│   └── manifest.json       # PWA manifest
├── src/
│   ├── components/         # React components
│   │   ├── Header.js       # App header
│   │   ├── StepIndicator.js # Progress indicator
│   │   ├── EmailConnectionWizard.js # Step 1: Email connection
│   │   ├── ProcessingStatus.js # Step 2: Processing status
│   │   ├── FAQDisplay.js   # Step 3: FAQ display
│   │   └── LoadingSpinner.js # Loading components
│   ├── services/
│   │   └── apiService.js   # API communication
│   ├── App.js              # Main app component
│   ├── index.js            # App entry point
│   └── index.css           # Global styles
├── tailwind.config.js      # Tailwind configuration
├── package.json            # Dependencies and scripts
└── README.md              # This file
```

## Components Overview

### App.js
Main application component that manages:
- Step navigation (1: Connect, 2: Process, 3: View FAQs)
- Socket.IO connection for real-time updates
- Global state management
- Error handling and notifications

### EmailConnectionWizard.js
Step 1 component featuring:
- OAuth 2.0 authentication for Gmail and Outlook
- Connected accounts display
- Security information
- Account disconnection functionality

### ProcessingStatus.js
Step 2 component showing:
- Real-time processing progress
- Connected accounts summary
- Processing steps with visual indicators
- Manual sync controls

### FAQDisplay.js
Step 3 component providing:
- FAQ search and filtering
- Category-based organization
- Inline editing capabilities
- Export functionality (JSON/CSV)
- FAQ management (edit/delete)

## API Integration

The frontend communicates with the backend through:

- **REST API**: Standard CRUD operations
- **Socket.IO**: Real-time updates during processing
- **OAuth 2.0**: Secure email account authentication

Key API endpoints:
- `GET /api/accounts` - Get connected accounts
- `POST /api/emails/sync` - Start email processing
- `GET /api/faqs` - Get generated FAQs
- `PUT /api/faqs/:id` - Update FAQ
- `GET /api/export/faqs` - Export FAQs

## Styling

The app uses Tailwind CSS with custom components:
- Custom color palette (primary, success, warning)
- Responsive design utilities
- Animation classes with Framer Motion
- Custom component classes (btn-primary, card, etc.)

## Real-time Features

Socket.IO integration provides:
- Live processing status updates
- Progress bar animations
- Completion notifications
- Error handling

## Development Tips

1. **Hot Reload**: Changes are automatically reflected during development
2. **API Proxy**: Development server proxies API requests to backend
3. **Environment Variables**: Use `REACT_APP_` prefix for client-side variables
4. **Debugging**: React DevTools and browser console for debugging

## Building and Deployment

### Local Build
```bash
npm run build
```

### Production Deployment
The build is automatically served by the backend in production mode. The backend serves static files from `client/build/` when `NODE_ENV=production`.

## Troubleshooting

### Common Issues

1. **API Connection Failed**
   - Check if backend server is running
   - Verify `REACT_APP_API_URL` in `.env`

2. **OAuth Not Working**
   - Verify client IDs in `.env`
   - Check OAuth redirect URIs in Google/Microsoft consoles

3. **Socket.IO Connection Issues**
   - Ensure `REACT_APP_SOCKET_URL` matches backend
   - Check CORS configuration in backend

4. **Build Errors**
   - Clear node_modules and reinstall: `rm -rf node_modules && npm install`
   - Check for TypeScript errors if using TS

### Performance Optimization

- Components use React.memo for optimization
- Lazy loading for large components
- Efficient re-renders with proper dependency arrays
- Image optimization and compression

## Contributing

1. Follow React best practices
2. Use functional components with hooks
3. Implement proper error boundaries
4. Add PropTypes for type checking
5. Write unit tests for components
6. Follow the existing code style

## License

MIT License - see main project LICENSE file.