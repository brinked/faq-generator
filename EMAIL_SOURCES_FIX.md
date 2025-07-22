# Email Sources Modal Fix

## Issue
The email sources modal was loading but showing no data, despite the backend API returning the correct data.

## Root Cause
The frontend code in `FAQDisplay.js` was trying to access `sources.sources` from the API response, but the API actually returns the data under `sources.emailSources`.

## Fix Applied
Changed line 201 in `client/src/components/FAQDisplay.js`:

```javascript
// Before:
sources: sources.sources || []

// After:
sources: sources.emailSources || []
```

## Verification Steps
1. Click on any FAQ item's "View Sources" button
2. The modal should now display the email sources correctly
3. Each email source should show:
   - Email subject
   - Sender name/email
   - Date received
   - Relevant snippet

## Deployment
- Commit: 75039f7
- Pushed to main branch
- Auto-deployment triggered on Render

## Additional Notes
The backend API at `/api/faq-sources/:id` returns data in this structure:
```json
{
  "emailSources": [
    {
      "email_subject": "...",
      "sender_name": "...",
      "sender_email": "...",
      "received_date": "...",
      "snippet": "..."
    }
  ]
}
```

The frontend was incorrectly looking for `sources.sources` instead of `sources.emailSources`.