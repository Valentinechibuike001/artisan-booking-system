
module.exports = {
  PAYMENT_WINDOW_MINUTES: 30,      // time to pay after booking
  ARTISAN_RESPONSE_HOURS: 24,      // time the artisan has to accept or decline
  DISPUTE_WINDOW_HOURS: 48,        // "Report problem" window after the job is done

  DEFAULT_DURATION_MINUTES: 120,   // for services without a duration
  MIN_DURATION_MINUTES: 30,
  MAX_DURATION_MINUTES: 480,
  DURATION_STEP_MINUTES: 15,       // durations must be multiples of this
  SLOT_STEP_MINUTES: 30,           // booking start times are offered this often

  MIN_LEAD_MINUTES: 120,           // can't book sooner than this
  MAX_DAYS_AHEAD: 60,
  FREE_CANCEL_HOURS: 24,           // cancel earlier than this = full refund
  LATE_CANCEL_REFUND_PERCENT: 50,  // cancel later than that = this refund
  DEFAULT_HOURS: { from: "08:00", to: "20:00" }, // if an artisan hasn't set a schedule

  REVIEW_WINDOW_DAYS: 30,          // how long after "Job done" a student can review
  REVIEW_EDIT_DAYS: 7,             // how long a student can edit their review
  MAX_REVIEW_PHOTOS: 3,
  MAX_REVIEW_COMMENT: 500,
  DISPUTE_MIN_REASON: 20,          // shortest description of the problem
  DISPUTE_MAX_REASON: 1000,
  MAX_DISPUTE_PHOTOS: 4,
  MAX_REPORTS_PER_DAY: 5,
  MAX_BLOCKS: 100,
   CATEGORIES: ["Electrical", "Plumbing", "Baking", "Decor", "Repairs", "Beauty", "Other"],

  DISPUTE_ALERT_THRESHOLD: 3,          // tell admins when an artisan has this many upheld disputes
  AUTO_SUSPEND_UPHELD_DISPUTES: 0,     // 0 = never suspend automatically (e.g. 5 = suspend at 5)
  DISPUTE_RATE_DAYS: 90,               // only look at this many recent days
  EXPORT_MAX_ROWS: 5000,
  DISPUTE_ARTISAN_NUDGE_HOURS: 24,   // remind an artisan who hasn't answered a dispute
  DISPUTE_ADMIN_ALERT_HOURS: 48,     // warn admins when a dispute has waited this long
  REPORT_ADMIN_ALERT_HOURS: 72,      // same for user reports
  REVIEW_REMINDER_AFTER_DAYS: 2,     // "rate your job" reminder, after the student confirmed
  ROLE_REQUESTS_PER_MONTH: 3,
  LEGAL_VERSION: "1.0",            // change this when you publish new Terms or a new Privacy Policy
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 72,                // bcrypt only reads the first 72 characters
  TRAVEL_BUFFER_MINUTES: 15,      // gap kept between two jobs of the same artisan
  ALLOWED_BUFFERS: [0, 15, 30, 45, 60],   // gaps an artisan can choose between jobs
  MAX_BUFFER_MINUTES: 60,
  PAYOUT_TWO_PERSON_THRESHOLD: 100000,    // payouts this big need a second admin to mark them paid
  DAILY_SUMMARY_HOUR: 8,                  // hour (Nigerian time) the admin summary is sent

};