# Shared — HomeEase API Client

Used by **Front-End (admin web)** and **mobile app** to call the same REST API.

## Admin web usage

Already wired in `Front-End/src/services/apiClient.js`.

## Mobile usage

Copy this folder into the mobile project, or import via monorepo path.

```javascript
import { createApiClient } from './shared/api-client/index.js';

// React Native example — implement storage with AsyncStorage
const mobileStorage = {
  getToken: () => AsyncStorage.getItem('homeease_token'),
  getUser: async () => JSON.parse(await AsyncStorage.getItem('homeease_user')),
  setSession: (token, user) => {
    AsyncStorage.setItem('homeease_token', token);
    AsyncStorage.setItem('homeease_user', JSON.stringify(user));
  },
  clearSession: () => {
    AsyncStorage.multiRemove(['homeease_token', 'homeease_user']);
  },
};

export const api = createApiClient({
  getBaseUrl: () => 'https://your-api.com/api',
  storage: mobileStorage,
});

// Mobile signup
await api.signup({ fullName, email, phone, password, role: 'CLIENT' });

// Upload verification documents
const formData = new FormData();
formData.append('documentType', 'Valid ID');
formData.append('services', 'Plumbing, Electrical');
formData.append('documents', { uri, name, type });
await api.apiRequest('/verification/upload', { method: 'POST', body: formData });
```

## Constants

Import role and status enums from `shared/constants/index.js` so admin, mobile, and backend stay aligned.
