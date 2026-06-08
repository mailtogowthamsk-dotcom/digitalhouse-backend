-- P0: payment orders + webhook dedupe (prefer npm run db:run-matrimony-razorpay-sql)

CREATE TABLE IF NOT EXISTS matrimony_payment_orders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  purpose ENUM('SUBSCRIPTION_GOLD','SUBSCRIPTION_PLATINUM','CONTACT_REVEAL') NOT NULL,
  amount_paise INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  razorpay_order_id VARCHAR(64) NOT NULL,
  razorpay_payment_id VARCHAR(64) NULL,
  status ENUM('CREATED','PAID','FAILED') NOT NULL DEFAULT 'CREATED',
  meta JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mat_pay_rzp_order (razorpay_order_id),
  KEY idx_mat_pay_user_status (user_id, status),
  KEY idx_mat_pay_user_purpose_status (user_id, purpose, status),
  CONSTRAINT fk_mat_pay_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS razorpay_webhook_events (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rzp_webhook_event (event_id),
  KEY idx_rzp_webhook_type (event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
