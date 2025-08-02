-- Migration: Add Authentication and Public FAQ System
-- This migration adds admin authentication and public FAQ display functionality

-- Admin users table for authentication
CREATE TABLE admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Admin sessions table for JWT token management
CREATE TABLE admin_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Public FAQs table (separate from internal FAQ groups)
CREATE TABLE public_faqs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(500) NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category VARCHAR(100),
    tags TEXT[],
    search_keywords TEXT[], -- For better search functionality
    is_published BOOLEAN DEFAULT FALSE,
    view_count INTEGER DEFAULT 0,
    helpful_count INTEGER DEFAULT 0,
    not_helpful_count INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add is_public field to existing faq_groups table
ALTER TABLE faq_groups ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;

-- Create indexes for new tables
CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_active ON admin_users(is_active);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_id ON admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_public_faqs_published ON public_faqs(is_published);
CREATE INDEX IF NOT EXISTS idx_public_faqs_category ON public_faqs(category);
CREATE INDEX IF NOT EXISTS idx_public_faqs_sort_order ON public_faqs(sort_order);
CREATE INDEX IF NOT EXISTS idx_public_faqs_search_keywords ON public_faqs USING gin(search_keywords);
CREATE INDEX IF NOT EXISTS idx_public_faqs_search_gin ON public_faqs USING gin(to_tsvector('english', title || ' ' || question || ' ' || answer));

-- Add triggers for updated_at
CREATE TRIGGER update_admin_users_updated_at BEFORE UPDATE ON admin_users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_public_faqs_updated_at BEFORE UPDATE ON public_faqs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default admin user (password will be set via environment variable)
INSERT INTO admin_users (username, email, password_hash) VALUES 
('admin', 'admin@faqgenerator.com', '$2b$10$default.hash.placeholder');

-- Insert default system settings for admin
INSERT INTO system_settings (key, value, description) VALUES
('admin_username', '"admin"', 'Default admin username'),
('admin_email', '"admin@faqgenerator.com"', 'Default admin email'),
('public_faq_search_enabled', 'true', 'Enable search on public FAQ page'),
('public_faq_categories_enabled', 'true', 'Enable category filtering on public FAQ page'); 