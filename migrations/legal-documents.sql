-- Legal Documents Management (idempotent)
-- Catalog + versioned documents + immutable acceptances

CREATE TABLE IF NOT EXISTS legal_document_types (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_key VARCHAR(64) NOT NULL,
  title VARCHAR(160) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 100,
  required_at_registration TINYINT(1) NOT NULL DEFAULT 0,
  requires_reacceptance TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_legal_types_key (document_key),
  UNIQUE KEY uq_legal_types_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS legal_documents (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_key VARCHAR(64) NOT NULL,
  title VARCHAR(160) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  content LONGTEXT NOT NULL,
  content_format ENUM('html', 'markdown') NOT NULL DEFAULT 'html',
  version VARCHAR(20) NOT NULL,
  version_major INT UNSIGNED NOT NULL DEFAULT 1,
  version_minor INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  published_at DATETIME NULL,
  change_summary VARCHAR(500) NULL,
  created_by VARCHAR(191) NULL,
  updated_by VARCHAR(191) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_legal_docs_key_version (document_key, version),
  KEY idx_legal_docs_key_published (document_key, is_published),
  KEY idx_legal_docs_slug_published (slug, is_published),
  KEY idx_legal_docs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS legal_document_acceptances (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  document_key VARCHAR(64) NOT NULL,
  document_id INT UNSIGNED NOT NULL,
  version VARCHAR(20) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'settings',
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  accepted_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_legal_accept_user_key_version (user_id, document_key, version),
  KEY idx_legal_accept_user_key (user_id, document_key),
  KEY idx_legal_accept_document (document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
