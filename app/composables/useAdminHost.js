// True when the current request is on the operator console host
// (admin.localhost / admin.onecloudaway.de). The admin host is NOT a product
// tenant — it serves only the operator control-plane, so the SPA hides all
// tenant/profile UI here and the gateway blocks every non-/api/admin path.
// useRequestURL() resolves the host on both server and client (no hydration flash).
export const useAdminHost = () => useRequestURL().hostname.split('.')[0] === 'admin'
