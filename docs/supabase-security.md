# Supabase Security Guide

## 🔐 ANON_KEY Security

### Is ANON_KEY Safe to Expose?

**Short answer**: Yes, but with important caveats.

### How Supabase Security Works

1. **ANON_KEY is Public by Design**
   - Supabase ANON_KEY is meant to be exposed in frontend code
   - It's not a secret - anyone can see it in your JavaScript bundle
   - This is intentional and documented by Supabase

2. **Security Through Row Level Security (RLS)**
   - The ANON_KEY cannot bypass RLS policies
   - All database access is controlled by RLS policies
   - Users can only access data they're authorized to see
   - RLS policies run on the database server, not the client

3. **What ANON_KEY Can Do**
   - ✅ Access data according to RLS policies
   - ✅ Authenticate users (with Supabase Auth)
   - ✅ Make queries that respect user permissions
   - ❌ Cannot bypass RLS
   - ❌ Cannot access data without proper policies
   - ❌ Cannot perform admin operations

### ⚠️ Important Security Requirements

**CRITICAL**: For ANON_KEY to be safe, you MUST:

1. **Enable RLS on ALL tables**
   ```sql
   ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
   ```

2. **Create proper RLS policies**
   ```sql
   -- Example: Users can only see their own projects
   CREATE POLICY "Users can view own projects"
     ON projects FOR SELECT
     USING (auth.uid() = user_id);
   ```

3. **Never use SERVICE_ROLE_KEY in frontend**
   - SERVICE_ROLE_KEY bypasses RLS
   - It's a secret and must stay on the server
   - Only use in Supabase Edge Functions or backend

### 🔒 Best Practices

#### ✅ Safe Practices:
- Use ANON_KEY in frontend with RLS enabled
- Always verify RLS policies are active
- Test that users can't access other users' data
- Use Supabase Auth for user identification

#### ❌ Unsafe Practices:
- Disabling RLS on any table
- Using SERVICE_ROLE_KEY in frontend
- Trusting client-side validation alone
- Exposing API keys (OpenAI, DataForSEO) in frontend

### 🛡️ Additional Security Layers

For maximum security, consider:

1. **Supabase Edge Functions**
   - Keep ANON_KEY in frontend for basic operations
   - Use Edge Functions for sensitive operations
   - Edge Functions can use SERVICE_ROLE_KEY securely

2. **Backend API**
   - Create a separate backend API
   - Hide all API keys (OpenAI, DataForSEO)
   - Frontend only calls your backend

3. **API Rate Limiting**
   - Implement rate limiting on Edge Functions
   - Prevent abuse of your Supabase quota

### 📋 Security Checklist

- [ ] RLS enabled on ALL tables
- [ ] RLS policies tested and verified
- [ ] Users can only access their own data
- [ ] No SERVICE_ROLE_KEY in frontend code
- [ ] API keys (OpenAI, DataForSEO) in backend only
- [ ] Rate limiting implemented
- [ ] Regular security audits

### 🔍 How to Verify RLS is Working

1. **Check if RLS is enabled:**
   ```sql
   SELECT tablename, rowsecurity 
   FROM pg_tables 
   WHERE schemaname = 'public';
   ```

2. **Test as different users:**
   - Create test accounts
   - Verify users can't see each other's data
   - Test edge cases

3. **Review RLS policies:**
   ```sql
   SELECT * FROM pg_policies 
   WHERE schemaname = 'public';
   ```

### 📚 Resources

- [Supabase RLS Documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Security Best Practices](https://supabase.com/docs/guides/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

### 🚨 If ANON_KEY is Compromised

If you're concerned about ANON_KEY exposure:

1. **Rotate the key** in Supabase Dashboard
2. **Verify RLS policies** are still active
3. **Review access logs** for suspicious activity
4. **Consider using Edge Functions** for sensitive operations

Remember: With proper RLS, even if someone has your ANON_KEY, they can only access data according to your policies.

