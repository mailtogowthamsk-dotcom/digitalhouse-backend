/**
 * Production legal-document seed content for Digital House.
 *
 * The returned strings are HTML fragments intended for rendering inside the
 * application's legal-document container. Identity values are supplied by the
 * seed caller so deployments can configure their own legal contact details.
 */

export type LegalSeedContent = { documentKey: string; title: string; content: string };

export type LegalIdentity = {
  platformName: string;
  jurisdiction: string;
  governingLaw: string;
  supportEmail: string;
  privacyEmail: string;
  legalEmail: string;
};

function document(
  documentKey: string,
  title: string,
  content: string
): LegalSeedContent {
  return { documentKey, title, content: content.trim() };
}

export function buildLegalSeedDocuments(identity: LegalIdentity): LegalSeedContent[] {
  return [
    document(
      "privacy_policy",
      "Privacy Policy",
      `
<h2>Privacy Policy</h2>
<p><strong>${identity.platformName}</strong> respects the privacy of its members. This Privacy Policy explains how information is collected, used, disclosed, retained, and protected when you access our website, mobile application, and related services. These services include the Community Feed, Member Profiles, Connections, Chat, Marketplace, Matrimony, Subscription Plans, Push Notifications, verification, reporting, blocking, and admin moderation (together, the <strong>“Services”</strong>).</p>
<p>This Policy should be read with our Terms &amp; Conditions, Community Guidelines, Content Moderation Policy, Account Deletion &amp; Data Retention Policy, and other notices shown when a feature requests information. By using the Services, you acknowledge the practices described here. If you do not agree, please discontinue use and request account deletion where appropriate.</p>
<blockquote><strong>Privacy contact:</strong> Questions, requests, and complaints concerning personal information may be sent to <a href="mailto:${identity.privacyEmail}">${identity.privacyEmail}</a>. General product support is available at <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a>.</blockquote>

<h3>1. Scope and roles</h3>
<p>This Policy covers information processed through the Services, support, and moderation. It does not govern independent third parties. Members control what they publish and must have permission to share information about others.</p>

<h3>2. Information we collect</h3>
<table>
  <thead><tr><th>Category</th><th>Examples</th><th>Typical source</th></tr></thead>
  <tbody>
    <tr><td><strong>Registration and account</strong></td><td>Name, username, email address, mobile number, password credentials in protected form, date of birth, gender, preferred language, account status, and sign-in records.</td><td>You, authentication providers, and service logs.</td></tr>
    <tr><td><strong>Community and profile</strong></td><td>Profile photo, biography, community details, hometown, district, education, occupation, interests, Connections, followed accounts, posts, comments, reactions, and other profile fields you choose to provide.</td><td>You and your interactions with members.</td></tr>
    <tr><td><strong>Verification</strong></td><td>Verification submissions, supporting documents or images, review notes, verification status, rejection reasons, and fraud-prevention signals.</td><td>You, authorized reviewers, and validation providers.</td></tr>
    <tr><td><strong>Communications</strong></td><td>Chat messages, attachments, support correspondence, report descriptions, appeal submissions, and records of blocks or moderation notices.</td><td>You, message recipients, reporters, and moderators.</td></tr>
    <tr><td><strong>Marketplace</strong></td><td>Listings, item descriptions, price, category, photographs, approximate area, seller or buyer communications, transaction references, dispute material, and listing status.</td><td>Buyers, sellers, and platform activity.</td></tr>
    <tr><td><strong>Matrimony</strong></td><td>Age, education, occupation, family and lifestyle details, preferences, photographs, profile visibility, interests expressed, contact-unlock history, and safety reports.</td><td>You and matrimony interactions.</td></tr>
    <tr><td><strong>Subscriptions and payments</strong></td><td>Plan, price, currency, billing status, order and payment references, renewal status, refund history, and limited payment metadata. Full card, bank, or wallet credentials are generally handled by the payment provider.</td><td>You, app stores, and payment providers.</td></tr>
    <tr><td><strong>Device and usage</strong></td><td>Device type, operating system, app version, IP address, approximate network location, language, time zone, advertising or installation identifiers where permitted, pages viewed, button interactions, session times, and referral source.</td><td>Your device and our service logs.</td></tr>
    <tr><td><strong>Diagnostics and safety</strong></td><td>Crash reports, performance events, authentication attempts, suspected spam or fraud signals, content hashes, report history, enforcement decisions, and audit logs.</td><td>Devices, automated systems, members, and admins.</td></tr>
  </tbody>
</table>

<h3>3. Photos, videos, audio, and files</h3>
<p>When you upload photos or videos to the Community Feed, Member Profile, Chat, Marketplace, or Matrimony, we process the file and related metadata so it can be stored, resized, transcoded, previewed, delivered, moderated, and recovered. Depending on the file and your device, embedded metadata may include capture time or location. You should remove metadata you do not wish to share and obtain consent from people depicted in your media.</p>
<p>Visible media can be copied despite controls. <em>Do not upload identity documents, intimate media, medical or financial records, or another person’s private material unless requested and authorized.</em></p>

<h3>4. Device permissions</h3>
<ul>
  <li><strong>Camera:</strong> used only after permission to capture a profile image, post, marketplace listing, matrimony photo, verification image, or chat attachment.</li>
  <li><strong>Photo and media library:</strong> used to select content you choose to upload. Broad library access is not required where your operating system supports a limited picker.</li>
  <li><strong>Microphone:</strong> may be requested when recording video or another feature that expressly uses audio.</li>
  <li><strong>Location:</strong> precise or approximate location may be requested for location-based discovery, nearby Marketplace results, address assistance, or safety-relevant functionality. We do not require continuous background location unless a feature clearly states this before permission.</li>
  <li><strong>Notifications:</strong> used to deliver connection requests, chat alerts, activity, Marketplace updates, Matrimony interests, subscription notices, safety alerts, and announcements.</li>
</ul>
<p>Permissions are controlled through your device settings and can be withdrawn at any time. Refusing a permission will normally affect only the feature that needs it. Information already uploaded before permission is withdrawn remains subject to this Policy and your deletion choices.</p>

<h3>5. How we use information</h3>
<ul>
  <li>create, authenticate, verify, secure, and administer member accounts;</li>
  <li>display profiles and Community Feed content according to feature rules and privacy settings;</li>
  <li>recommend relevant posts, people, Connections, Marketplace listings, or Matrimony profiles;</li>
  <li>deliver Chat messages, media, transaction communications, and Push Notifications;</li>
  <li>provide Subscription Plan benefits, confirm payment status, prevent duplicate entitlements, and process support or refund requests;</li>
  <li>review verification requests, reports, appeals, blocks, suspicious behavior, and policy violations;</li>
  <li>detect spam, scams, impersonation, account takeover, prohibited content, and threats to member safety;</li>
  <li>measure audience, feature performance, reliability, errors, and service quality through analytics;</li>
  <li>communicate administrative changes, policy updates, security notices, and service messages;</li>
  <li>establish, exercise, or defend legal claims and comply with obligations under ${identity.governingLaw}; and</li>
  <li>develop and improve the Services using aggregated, de-identified, or appropriately controlled information.</li>
</ul>

<h3>6. Personalisation and analytics</h3>
<p>Feed and discovery ranking may use selected community, Connections, interactions, language, broad location, and safety signals. Analytics measure installations, use, crashes, and notification delivery. Optional identifiers require consent where applicable; private Chat is not used for third-party advertising.</p>

<h3>7. Push notifications and communications</h3>
<p>Push tokens and account preferences allow us to route notifications to your device. Essential notices may concern security, verification, transactions, subscriptions, moderation, or material policy changes. You can manage optional notifications in ${identity.platformName} or through device settings. Disabling push notifications does not prevent important notices from appearing in-app or being sent by another contact method you supplied.</p>

<h3>8. When information is disclosed</h3>
<table>
  <thead><tr><th>Recipient</th><th>Purpose and limits</th></tr></thead>
  <tbody>
    <tr><td><strong>Other members</strong></td><td>Profile fields, posts, comments, reactions, listing details, matrimony information, connection state, and messages are shared according to the feature and your settings. Blocking limits future interactions but cannot erase copies already received.</td></tr>
    <tr><td><strong>Vendors</strong></td><td>Hosting, databases, content delivery, storage, analytics, communications, verification, moderation, customer support, and security providers process only information needed for contracted services and must apply appropriate safeguards.</td></tr>
    <tr><td><strong>Payment and app-store providers</strong></td><td>Order identifiers and account details needed to initiate, reconcile, refund, investigate, or prove a Subscription Plan purchase.</td></tr>
    <tr><td><strong>Admins and moderators</strong></td><td>Information reasonably required to review verification, reported content, suspected abuse, appeals, support requests, and platform integrity.</td></tr>
    <tr><td><strong>Professional advisers and authorities</strong></td><td>Information may be disclosed to comply with valid legal process, protect rights or safety, investigate offences, enforce agreements, or obtain legal, audit, or insurance advice.</td></tr>
    <tr><td><strong>Corporate transaction participants</strong></td><td>Appropriately protected information may be reviewed or transferred during a merger, financing, reorganisation, sale, or transfer of all or part of the service.</td></tr>
  </tbody>
</table>
<p>${identity.platformName} does not sell personal information for money. Marketplace transactions and Matrimony communications are interactions between members; each recipient may independently use information you voluntarily provide to them.</p>

<h3>9. Verification and admin moderation</h3>
<p>Verification is intended to improve trust but does not guarantee identity, character, qualifications, solvency, marital status, product quality, or future conduct. Authorized admins may inspect submitted evidence, compare it with account information, record a decision, and retain limited evidence or audit data to prevent repeat fraud. Access is restricted to personnel with a legitimate operational need.</p>
<p>Reports may include copies of content, messages, listing details, profile fields, and contextual logs. We may preserve reported material even if it is later deleted where reasonably necessary to investigate, prevent recurrence, resolve an appeal, or meet legal obligations.</p>

<h3>10. Data retention</h3>
<p>Retention varies by data type, account status, sensitivity, operational need, contractual requirement, limitation period, and obligations under ${identity.governingLaw}. Account and profile data is generally kept while the account is active. Transaction and subscription records may be retained for accounting, tax, payment disputes, and fraud prevention. Security and moderation records may remain after suspension or deletion to protect members and enforce restrictions.</p>
<p>Deleted data can remain temporarily in backups, caches, logs, and disaster-recovery systems until the applicable cycle completes. Content already delivered to Chat recipients, quoted by others, included in a report, or lawfully preserved may not disappear from every context. We de-identify or delete data when continued identification is no longer reasonably necessary.</p>

<h3>11. Security</h3>
<p>We use risk-appropriate administrative, technical, and organizational controls, which may include access restrictions, authentication controls, encryption in transit, protected storage, logging, backups, vulnerability management, and incident procedures. No internet or storage system is completely secure. Members must use a strong unique password, protect one-time codes, keep devices updated, and notify <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a> promptly about suspected account compromise.</p>

<h3>12. Your rights and choices</h3>
<ul>
  <li>review and edit available Member Profile and Matrimony fields;</li>
  <li>control discoverability, media, Connections, notifications, and other available privacy settings;</li>
  <li>withdraw optional device permissions or consent without affecting processing already lawfully completed;</li>
  <li>download or request access to eligible personal information;</li>
  <li>request correction of inaccurate or incomplete personal information;</li>
  <li>request deletion or restriction, subject to legal and operational exceptions;</li>
  <li>object to or complain about certain processing and request review of an admin decision; and</li>
  <li>block members and report content or conduct.</li>
</ul>
<p>To exercise a privacy right, contact <a href="mailto:${identity.privacyEmail}">${identity.privacyEmail}</a>. We may verify your identity and authority before fulfilling a request. Rights are subject to ${identity.governingLaw}, and we may refuse or limit a request where an exception applies, explaining the basis when required.</p>

<h3>13. Children and sensitive information</h3>
<p>The Services are intended for adults who meet the eligibility requirements in our Terms, and Matrimony is strictly for adults. We do not knowingly permit children to create accounts. If you believe a child has supplied personal information, contact <a href="mailto:${identity.privacyEmail}">${identity.privacyEmail}</a>.</p>
<p>Community, caste or similar social identity, religious beliefs, health information, sexual orientation, government identifiers, precise location, and financial information may be sensitive under applicable law. Provide such information only when necessary and after considering who can view it. ${identity.platformName} does not require members to disclose sensitive information publicly.</p>

<h3>14. Cross-border processing and third-party links</h3>
<p>Providers may process data in other locations using required safeguards. External sites, stores, and payment pages have separate privacy terms.</p>

<h3>15. Complaints, law, and updates</h3>
<p>This Policy is interpreted under ${identity.governingLaw}, and privacy complaints or proceedings are subject to the competent authorities and courts associated with ${identity.jurisdiction}, except where mandatory law requires otherwise. You may first contact <a href="mailto:${identity.privacyEmail}">${identity.privacyEmail}</a> so we can investigate.</p>
<p>We may update this Policy to reflect legal, technical, or service changes. Material changes may be notified in-app, by email, or through a re-acceptance prompt. The version published in the Services supersedes earlier versions from its effective date.</p>
      `
    ),
    document(
      "terms",
      "Terms & Conditions",
      `
<h2>Terms &amp; Conditions</h2>
<p>These Terms &amp; Conditions (<strong>“Terms”</strong>) are a binding agreement governing your access to <strong>${identity.platformName}</strong>, including its mobile application, website, Community Feed, Member Profiles, Connections, Chat, Marketplace, Matrimony, Subscription Plans, Push Notifications, verification, moderation, reporting, and blocking features (collectively, the <strong>“Services”</strong>).</p>
<p>By registering, clicking acceptance, purchasing a plan, or using any part of the Services, you confirm that you have read and agree to these Terms and the policies incorporated into them. If you do not agree, do not use the Services. Legal correspondence may be sent to <a href="mailto:${identity.legalEmail}">${identity.legalEmail}</a>; product support is available at <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a>.</p>

<h3>1. Eligibility and authority</h3>
<ul>
  <li>You must be an adult with legal capacity to enter a contract under ${identity.governingLaw}.</li>
  <li>Matrimony features may be used only by eligible adults acting for themselves or, where clearly disclosed and legally permitted, by an authorized family representative with the profile subject’s informed permission.</li>
  <li>If you use the Services for an organisation or business, you represent that you are authorized to bind it.</li>
  <li>You must not use the Services if your account was previously terminated for serious misconduct unless ${identity.platformName} gives written permission.</li>
</ul>
<p>We may request age, identity, community, phone, email, or other verification. Approval, a badge, or account activation is not an endorsement and does not transfer responsibility for independent due diligence.</p>

<h3>2. Account registration and security</h3>
<p>You must provide truthful, current, and complete information and promptly correct changes. One person must not operate deceptive duplicate accounts, impersonate another person, create accounts by automation, or transfer an account without permission. You are responsible for protecting passwords, one-time codes, devices, and recovery methods and for activity performed through your account until you notify us of unauthorized access.</p>
<p>We may place an account in pending review, require additional verification, reject an application, limit features, or withdraw verification where information is inconsistent, incomplete, fraudulent, unsafe, or contrary to policy. Contact <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a> immediately if you suspect compromise.</p>

<h3>3. Licence to use the Services</h3>
<p>Subject to these Terms, ${identity.platformName} grants you a limited, personal, revocable, non-exclusive, non-transferable licence to access the Services for their intended lawful purposes. No ownership in the software, databases, trademarks, interface, or platform content is transferred to you.</p>
<p>Do not bypass controls, probe without authorization, scrape restricted areas, operate bots, overload systems, inject code, or copy the member database.</p>

<h3>4. Community Feed and Member Profiles</h3>
<p>The Community Feed permits members to publish posts, photos, videos, comments, reactions, and other material. Member Profiles make selected information available according to product settings. You are responsible for what you publish, the audience you select, and obtaining rights and consent for every person, work, brand, or location shown.</p>
<ul>
  <li>Do not treat ranking, recommendations, verification marks, reactions, Connections, or follower counts as professional or factual endorsements.</li>
  <li>Do not publish confidential information, identity documents, private addresses, financial credentials, or another person’s Chat messages without authorization.</li>
  <li>Content can be copied or captured by viewers. Privacy settings reduce exposure but cannot guarantee confidentiality.</li>
  <li>We may label, reduce distribution, disable interaction with, preserve, or remove content under our moderation policies.</li>
</ul>

<h3>5. Connections, Chat, blocking, and reporting</h3>
<p>Connections and Chat are communication tools, not a guarantee that another member is trustworthy or available. Messages and attachments are the sender’s responsibility. Unsolicited commercial messages, repeated contact after refusal, coercion, threats, sexual harassment, fraud, and attempts to move a victim to unsafe channels are prohibited.</p>
<p>Blocking generally restricts future profile discovery or communication between accounts but may not remove earlier messages, shared-group activity, transaction records, or evidence preserved for safety. Reporting sends relevant content and context for review. Reports must be made honestly; fabricated, retaliatory, or coordinated false reports can result in enforcement.</p>

<h3>6. Marketplace terms</h3>
<blockquote><strong>${identity.platformName} provides a listing and communication venue. Unless expressly identified as the seller in a particular offer, it is not the buyer, seller, manufacturer, broker, transporter, inspector, or guarantor of Marketplace goods or services.</strong></blockquote>
<p>Sellers must have the legal right to offer an item or service and must accurately describe its condition, ownership, price, location, defects, risks, taxes, delivery terms, and refund commitments. Buyers must inspect listings, verify identity and ownership, retain records, use safe payment methods, and meet in a safe public place where appropriate.</p>
<table>
  <thead><tr><th>Member responsibility</th><th>Required conduct</th></tr></thead>
  <tbody>
    <tr><td><strong>Legality</strong></td><td>Do not list prohibited, stolen, counterfeit, unsafe, recalled, regulated, infringing, or unlawfully obtained goods or services.</td></tr>
    <tr><td><strong>Accuracy</strong></td><td>Use current photos and disclose material defects, total price, recurring charges, and commercial status.</td></tr>
    <tr><td><strong>Transactions</strong></td><td>Agree payment, inspection, delivery, title, warranty, returns, and taxes directly. Never share passwords or one-time codes.</td></tr>
    <tr><td><strong>Disputes</strong></td><td>Members should first preserve evidence and communicate safely. We may assist with platform records but are not required to adjudicate private contracts.</td></tr>
  </tbody>
</table>
<p>Marketplace transactions are at the members’ own risk. We may remove listings, restrict sellers, cooperate with lawful investigations, or warn members, but moderation does not amount to inspection or certification.</p>

<h3>7. Matrimony terms and disclaimer</h3>
<blockquote><strong>Matrimony is an introduction and discovery feature only.</strong> ${identity.platformName} does not arrange or solemnise marriages, act as a matchmaker or counsellor, guarantee responses or outcomes, or certify identity, age, marital status, family information, education, employment, health, finances, criminal history, intentions, compatibility, or the accuracy of any profile.</blockquote>
<p>Members and families must independently verify all material representations, communicate with informed consent, arrange meetings safely, and obtain appropriate professional advice before making commitments or payments. A verification badge has limited scope and is not a background check. Never send money, valuables, intimate media, identity credentials, or financial access based solely on a profile or Chat conversation.</p>
<p>Discrimination, coercion, dowry solicitation, trafficking, stalking, forced marriage, deceptive marital-status claims, and harassment are prohibited. Matrimony preferences must be expressed lawfully and respectfully. Report suspicious conduct promptly and preserve relevant evidence.</p>

<h3>8. Subscription Plans, billing, and renewal</h3>
<p>Paid plans provide only the entitlements displayed at checkout for the stated period. Entitlements may include enhanced profile access, contact unlocks, visibility, or other digital features; they do not guarantee Connections, sales, Matrimony matches, responses, or any offline result.</p>
<ul>
  <li>Prices, taxes, duration, renewal terms, and included limits are shown before purchase and may vary by channel.</li>
  <li>Payments may be processed by an app store or payment provider under its own terms. You authorize the displayed charge and must provide valid billing information.</li>
  <li>Where automatic renewal is offered, it continues until cancelled through the purchasing channel before the renewal cutoff shown there.</li>
  <li>Removing the app, deleting content, or ceasing use does not itself cancel an external app-store subscription.</li>
  <li>Refund eligibility is governed by our Refund &amp; Cancellation Policy, the payment provider’s rules, and mandatory rights under ${identity.governingLaw}.</li>
</ul>
<p>We may correct pricing or entitlement errors, reject suspected fraudulent payments, revoke benefits obtained through a reversed payment, and change future plan offerings. Changes do not remove mandatory consumer rights.</p>

<h3>9. Push Notifications, permissions, and connectivity</h3>
<p>Optional device permissions are requested for the feature described at the time: camera and media permissions for photos or videos, location for relevant discovery or listing functions, microphone for audio capture, and notifications for alerts. You can revoke permissions through device settings, but affected features may stop working.</p>
<p>Push delivery is not guaranteed and can be delayed, duplicated, or suppressed by device, network, or provider conditions. Do not rely on Push Notifications for emergencies, critical health information, deadlines, payment confirmation, or personal safety.</p>

<h3>10. User content and intellectual property</h3>
<p>You retain your rights and grant ${identity.platformName} a worldwide, non-exclusive, royalty-free, sublicensable licence to host, format, transcode, deliver, display, secure, and moderate submitted content according to your settings. It ends after active deletion, subject to backup, legal, safety, and recipient copies. You represent that you have all required rights and permissions.</p>
<p>${identity.platformName} branding, software, interfaces, and databases remain protected. Detailed infringement notices may be sent to <a href="mailto:${identity.legalEmail}">${identity.legalEmail}</a>.</p>

<h3>11. Prohibited conduct</h3>
<ul>
  <li>illegal activity, threats, harassment, hate, exploitation, trafficking, non-consensual intimate content, or material endangering a child;</li>
  <li>impersonation, forged verification, romance or investment scams, phishing, malware, spam, pyramid schemes, or manipulation of platform metrics;</li>
  <li>sale of prohibited items, counterfeit goods, stolen property, unlawful services, or misleading commercial offers;</li>
  <li>data scraping, bypassing blocks or safeguards, extortion, dangerous medical deception, or coordinated abuse.</li>
</ul>

<h3>12. Moderation and enforcement</h3>
<p>We may use member reports, admin review, automated signals, and service records to investigate suspected violations. Depending on severity, history, context, and risk, we may warn, label, reduce distribution, remove content, restrict messaging or listings, withdraw verification, suspend benefits, freeze an account, terminate access, preserve evidence, or refer a matter to competent authorities.</p>
<p>We are not obliged to monitor every interaction and cannot guarantee that harmful content will be identified before exposure. Enforcement can be imperfect. Where an appeal is available, submit the notice details and relevant context to <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a>. Repeated submissions do not require repeated review absent new information.</p>

<h3>13. Third-party services</h3>
<p>App stores, payment processors, maps, websites, and member businesses are independent and governed by their own terms; links do not imply endorsement.</p>

<h3>14. Medical, professional, and emergency disclaimer</h3>
<blockquote><strong>${identity.platformName} is not a hospital, doctor, counsellor, lawyer, financial adviser, law-enforcement agency, emergency dispatcher, or crisis-response service.</strong> Community posts, Chats, Marketplace offers, and member profiles are user-generated and must not replace qualified advice.</blockquote>
<p>If you or another person may be in immediate danger, experiencing a medical emergency, at risk of self-harm, or facing a crime in progress, contact the appropriate local emergency service or authority immediately. Do not wait for a report response or Push Notification.</p>

<h3>15. Service availability and changes</h3>
<p>Features may change or be interrupted for legal, security, maintenance, or technical reasons. We do not promise uninterrupted availability, permanent storage, or support for every device.</p>

<h3>16. Disclaimers</h3>
<p>To the fullest extent allowed by ${identity.governingLaw}, the Services are provided on an <strong>“as is”</strong> and <strong>“as available”</strong> basis. We disclaim implied warranties of merchantability, fitness for a particular purpose, non-infringement, accuracy, quiet enjoyment, and outcomes. We do not warrant member identity or conduct, content accuracy, Marketplace quality or delivery, Matrimony compatibility, subscription results, notification delivery, or freedom from every harmful act.</p>

<h3>17. Limitation of liability</h3>
<p>To the fullest extent permitted by ${identity.governingLaw}, ${identity.platformName} and its personnel will not be liable for indirect, incidental, special, exemplary, punitive, or consequential loss; loss of profits, opportunity, reputation, data, or goodwill; or harm arising from member conduct, copied content, Marketplace transactions, Matrimony interactions, external payments, or reliance on user-generated information. Nothing in these Terms excludes liability that cannot lawfully be excluded.</p>
<p>Where liability cannot be excluded but may be limited, aggregate liability will not exceed the greater of the amount you paid directly for the affected Service during the twelve months before the claim or the minimum amount required by applicable law. This allocation applies only to the extent legally enforceable.</p>

<h3>18. Indemnity</h3>
<p>To the extent permitted by law, you will indemnify ${identity.platformName} against third-party claims arising from your unlawful content, transactions, infringement, or material breach, excluding our unlawful conduct.</p>

<h3>19. Suspension and termination</h3>
<p>You may stop using the Services and request deletion. We may suspend or terminate access for breach, risk, legal requirement, non-payment, prolonged inactivity, or discontinuation. Provisions that by nature should survive—including intellectual property, payment obligations, disclaimers, liability, dispute terms, and preserved enforcement records—continue after termination.</p>

<h3>20. Governing law and disputes</h3>
<p>These Terms are governed by ${identity.governingLaw}, without regard to conflict-of-law rules. Subject to mandatory consumer rights and any legally required pre-litigation process, competent courts associated with ${identity.jurisdiction} will have jurisdiction. Before commencing a non-urgent claim, the parties should attempt good-faith resolution by sending a written summary and requested remedy to <a href="mailto:${identity.legalEmail}">${identity.legalEmail}</a>.</p>

<h3>21. General terms</h3>
<p>If a provision is unenforceable, the remainder continues. Delay is not waiver. You may not assign these Terms without consent; we may assign them with a service reorganisation or transfer. These Terms and incorporated policies form the agreement for the Services.</p>
<p>We may update these Terms for legal, safety, technical, or service reasons. Material updates may require notice or renewed acceptance. Continued use after the effective date, where lawful, constitutes acceptance of the updated Terms.</p>
      `
    ),
    document(
      "community_guidelines",
      "Community Guidelines",
      `
<h2>Community Guidelines</h2>
<p><strong>${identity.platformName}</strong> is designed for constructive community participation, trusted Connections, respectful Chat, responsible commerce, and safe Matrimony discovery. These Community Guidelines apply to every account, Member Profile, post, comment, reaction, photo, video, message, Marketplace listing, Matrimony profile, report, and offline interaction arranged through the Services.</p>
<blockquote><strong>Think before you share:</strong> communicate as though the person is in front of you, verify claims before forwarding them, protect private information, and use reporting or blocking when an interaction becomes unsafe.</blockquote>

<h3>1. Respect and dignity</h3>
<p>Disagreement is permitted; abuse is not. Do not attack, shame, degrade, intimidate, or encourage hostility toward a person or group. Context, repetition, power imbalance, target vulnerability, and credible offline risk influence enforcement.</p>
<ul>
  <li>No threats of violence, death, sexual violence, abduction, property damage, or encouragement of self-harm.</li>
  <li>No targeted harassment, bullying, dogpiling, humiliating edits, dehumanizing language, or repeated unwanted contact.</li>
  <li>No hateful attacks, violent-extremist support, or sexual conduct directed at anyone without consent.</li>
</ul>

<h3>2. Authenticity and trustworthy profiles</h3>
<p>Represent yourself honestly. Satire or community pages must be clearly labelled and must not confuse viewers about affiliation. Verification cannot be forged, rented, transferred, or described as a guarantee.</p>
<ul>
  <li>Do not impersonate a person, family, business, admin, public authority, or ${identity.platformName} representative.</li>
  <li>Do not fabricate age, marital status, qualifications, employment, location, ownership, or identity to obtain trust or money.</li>
  <li>Do not manipulate engagement or evade suspension through another account.</li>
</ul>

<h3>3. Privacy and consent</h3>
<p>Do not expose another person’s home address, private phone or email, live location, financial information, passwords, one-time codes, identity documents, medical records, private correspondence, or other sensitive data without clear authorization. Publicly available information can still be prohibited when compiled or shared to harass, threaten, or facilitate harm.</p>
<p>Before posting photos or videos, consider the expectations and safety of everyone shown. Remove content when a person reasonably withdraws consent, particularly for private settings. Never share intimate imagery without the depicted adult’s explicit consent, even if it was originally received consensually.</p>

<h3>4. Child safety</h3>
<p>Any sexual exploitation, grooming, trafficking, solicitation, or endangerment of a child is prohibited. Do not sexualize minors, request or distribute exploitative imagery, arrange inappropriate contact, or reveal information that creates a foreseeable risk. Apparent child sexual abuse material may be removed, preserved, and reported to competent authorities without advance notice.</p>

<h3>5. Community Feed standards</h3>
<table>
  <thead><tr><th>Allowed with care</th><th>Not allowed</th></tr></thead>
  <tbody>
    <tr><td>Good-faith opinions, criticism, cultural discussion, and debate.</td><td>Threats, targeted slurs, harassment, manipulated accusations, or calls for mob action.</td></tr>
    <tr><td>News or public-interest discussion with context and a reliable source.</td><td>Dangerous deception, fabricated evidence, or false claims likely to cause serious harm.</td></tr>
    <tr><td>Non-graphic awareness content about difficult events.</td><td>Gratuitous gore, celebration of suffering, or media published to shock or intimidate.</td></tr>
    <tr><td>Original photos, videos, or properly licensed works.</td><td>Pirated, infringing, secretly recorded, voyeuristic, or non-consensual media.</td></tr>
    <tr><td>Occasional relevant promotion where feature rules allow it.</td><td>Spam, repetitive solicitation, engagement bait, chain messages, or deceptive links.</td></tr>
  </tbody>
</table>

<h3>6. Connections and Chat etiquette</h3>
<p>A Connection request or reply does not imply romantic, commercial, or ongoing consent. Respect silence, refusal, blocking, and boundaries. Do not send repeated requests, mass unsolicited messages, sexual material, intimidation, or manipulative appeals. Never ask for passwords, one-time codes, remote-device access, or hurried payment.</p>
<p>Private Chat is still subject to these Guidelines. A recipient may report messages and attachments, and admins may review the reported context. Attempts to move a person off-platform to avoid safety controls can increase enforcement severity.</p>

<h3>7. Marketplace conduct</h3>
<ul>
  <li>List only lawful goods or services you have authority to offer.</li>
  <li>Use truthful titles, current photographs, complete prices, and clear descriptions of defects and commercial terms.</li>
  <li>Do not offer weapons, illegal drugs, stolen goods, counterfeit items, exploitative services, unsafe medical products, personal data, fake documents, or other prohibited items.</li>
  <li>Do not use advance-fee scams, false urgency, off-platform payment deception, fake escrow, or requests for financial credentials.</li>
  <li>Meet safely, inspect before paying, use traceable methods, and preserve receipts and conversations.</li>
</ul>
<p>${identity.platformName} does not certify listings. Marketplace access may be removed based on credible safety risk even before a private dispute is resolved.</p>

<h3>8. Matrimony conduct</h3>
<p>Matrimony participation must be adult, voluntary, respectful, and truthful. Do not misrepresent identity, age, marital status, family authorization, education, work, health, finances, or intentions. Do not pressure anyone to communicate, meet, share photos, reveal contact information, pay money, or proceed toward marriage.</p>
<ul>
  <li>Dowry demands, trafficking, forced marriage, stalking, blackmail, and intimate-image threats are prohibited.</li>
  <li>Do not collect Matrimony profiles for databases, marketing, or circulation outside the intended family discussion.</li>
  <li>Do not publish private rejection reasons or shame a member for declining interest.</li>
  <li>Independent identity, background, and document checks remain each member’s responsibility.</li>
</ul>

<h3>9. Dangerous, illegal, and regulated activity</h3>
<p>Do not facilitate crime, fraud, hacking, trafficking, exploitation, weapons construction, or serious harm. Legitimate documentary or prevention context must not create unreasonable risk.</p>

<h3>10. Health, emergencies, and misinformation</h3>
<p>Members may share personal experiences, but must not impersonate professionals, prescribe restricted treatment unlawfully, or promote demonstrably dangerous claims likely to cause serious injury. Clearly distinguish opinion from professional advice and disclose relevant commercial interests.</p>
<blockquote>${identity.platformName} is not an emergency or medical service. Contact appropriate local emergency responders or qualified professionals immediately when safety, health, self-harm, violence, or a crime in progress is involved.</blockquote>

<h3>11. Intellectual property</h3>
<p>Post only content you may lawfully use and provide required attribution. Rights holders may send a detailed notice to <a href="mailto:${identity.legalEmail}">${identity.legalEmail}</a>.</p>

<h3>12. Spam and platform manipulation</h3>
<p>Bulk messaging, bots, scraping, malware, referral abuse, fake promotions, purchased engagement, coordinated reporting, and recommendation manipulation are prohibited.</p>

<h3>13. Reporting and blocking</h3>
<p>Use the closest report reason, include relevant context, and preserve urgent evidence. Reports are confidential to the extent practical but information may be shared where needed for investigation, fairness, or law. Blocking can stop many direct interactions, but it cannot undo screenshots, completed transactions, or content already delivered.</p>
<p>Do not threaten reports to obtain money, attention, content removal, or a relationship. False reports, edited evidence, report brigading, and retaliation against reporters violate these Guidelines.</p>

<h3>14. Enforcement framework</h3>
<table>
  <thead><tr><th>Possible action</th><th>When it may be used</th></tr></thead>
  <tbody>
    <tr><td><strong>Education or warning</strong></td><td>Lower-risk, first-time, or remediable conduct.</td></tr>
    <tr><td><strong>Label or distribution limit</strong></td><td>Sensitive, disputed, repetitive, or low-quality content.</td></tr>
    <tr><td><strong>Removal</strong></td><td>Prohibited content, rights violations, safety risks, or legal requirements.</td></tr>
    <tr><td><strong>Feature restriction</strong></td><td>Abuse of Chat, Marketplace, Matrimony, posting, reporting, or Connections.</td></tr>
    <tr><td><strong>Suspension or termination</strong></td><td>Severe harm, repeated violations, evasion, fraud, or credible imminent risk.</td></tr>
    <tr><td><strong>Authority referral</strong></td><td>Valid legal process, suspected serious offence, child safety, or imminent danger.</td></tr>
  </tbody>
</table>
<p>We consider severity, intent, context, reach, target vulnerability, prior conduct, cooperation, and risk of recurrence. We may act without prior warning when delay could increase harm. Appeals can be sent with the relevant reference to <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a>.</p>

<h3>15. Shared responsibility</h3>
<p>Moderation cannot detect every violation. Secure your account, limit sensitive disclosures, verify claims, and meet safely. These Guidelines follow ${identity.governingLaw} and may evolve.</p>
      `
    ),
    document(
      "refund_policy",
      "Refund & Cancellation Policy",
      `
<h2>Refund &amp; Cancellation Policy</h2>
<p>This Refund &amp; Cancellation Policy applies to paid Subscription Plans and digital entitlements offered through <strong>${identity.platformName}</strong>. It supplements the checkout disclosure, Terms &amp; Conditions, payment-provider rules, and mandatory consumer protections under ${identity.governingLaw}.</p>
<blockquote><strong>Important:</strong> A subscription provides access to specified digital features for a period or usage limit. It does not guarantee profile approval, Community Feed reach, Connections, Marketplace sales, Matrimony matches, replies, meetings, marriage, or any other member action or offline outcome.</blockquote>

<h3>1. Before purchasing</h3>
<p>Review all plan, price, duration, limit, renewal, and channel details at checkout. Ask <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a> about unclear material terms before paying.</p>

<h3>2. Payment channels</h3>
<table>
  <thead><tr><th>Purchase channel</th><th>How cancellation or refund is handled</th></tr></thead>
  <tbody>
    <tr><td><strong>Direct payment to ${identity.platformName}</strong></td><td>Submit a request to <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a>. We review eligibility under this Policy and ${identity.governingLaw}.</td></tr>
    <tr><td><strong>Mobile app store</strong></td><td>Manage renewal and request refunds through the store account used to purchase. The store controls approval and settlement under its rules.</td></tr>
    <tr><td><strong>Third-party payment or promotion</strong></td><td>The named provider or sponsor may control cancellation, refund, and promotional-value terms. We will provide reasonable account evidence where appropriate.</td></tr>
  </tbody>
</table>
<p>Do not send full card numbers, bank passwords, personal identification numbers, or one-time codes to support. We may request an order ID, payment reference, masked payment details, invoice, or screenshot sufficient to locate the transaction.</p>

<h3>3. Cancelling automatic renewal</h3>
<p>Where recurring billing is offered, cancellation stops future renewal but ordinarily does not reverse the current paid period. You must cancel through the original purchase channel before its stated renewal cutoff. Processing times and time zones can vary, so act in advance.</p>
<ul>
  <li>Deleting the application does not cancel a subscription.</li>
  <li>Logging out, hiding a profile, disabling Push Notifications, or ceasing use does not cancel a subscription.</li>
  <li>Requesting account deletion does not automatically cancel billing administered by an app store or external provider; cancel there separately.</li>
  <li>After cancellation, eligible benefits generally continue until the end of the paid term unless a refund, charge reversal, violation, or plan rule ends them sooner.</li>
</ul>

<h3>4. General refund principles</h3>
<p>Digital features can be delivered immediately and may be consumed when viewed, unlocked, boosted, contacted, or otherwise used. Except where ${identity.governingLaw}, a provider rule, or a checkout promise requires otherwise, completed Subscription Plan purchases are generally final once material digital benefits have been activated or consumed.</p>
<p>Each request is assessed on transaction evidence, delivery state, consumption, timing, reason, prior adjustments, fraud signals, and mandatory rights. Approval in one case does not create a right in another.</p>

<h3>5. Situations generally eligible for review</h3>
<ul>
  <li><strong>Duplicate charge:</strong> substantially identical charges for the same account and entitlement caused by a verified processing error.</li>
  <li><strong>Charged but not activated:</strong> successful payment where the promised entitlement was not made available after reasonable troubleshooting.</li>
  <li><strong>Incorrect amount:</strong> a verified charge materially different from the confirmed checkout amount, excluding bank conversion or issuer fees.</li>
  <li><strong>Unauthorized transaction:</strong> credible evidence that the account or payment method was used without authority, subject to security review and provider procedures.</li>
  <li><strong>Material service failure:</strong> prolonged platform failure that prevented meaningful use of the paid feature and for which a proportionate extension or credit is not adequate.</li>
  <li><strong>Mandatory legal right:</strong> any refund, cancellation, or remedy that cannot be excluded under ${identity.governingLaw}.</li>
</ul>

<h3>6. Situations generally not refundable</h3>
<ul>
  <li>change of mind after activation or use of material plan benefits;</li>
  <li>failure to cancel before automatic renewal;</li>
  <li>lack of a match, reply, sale, meeting, engagement, marriage, or other outcome not controlled by ${identity.platformName};</li>
  <li>removal of content or restriction of an account for a policy violation, unless mandatory law requires a remedy;</li>
  <li>personal non-use, failed eligibility, external fees, or complimentary and expired benefits.</li>
</ul>

<h3>7. Matrimony and consumable entitlements</h3>
<p>A Matrimony contact reveal, interest, profile unlock, visibility boost, or similar unit may be treated as consumed once initiated or made available, even if the other member does not respond or later blocks, declines, hides, or deletes a profile. ${identity.platformName} does not warrant the accuracy or availability of member-provided Matrimony information and cannot refund solely because an introduction does not progress.</p>
<p>We may restore a unit or provide another proportionate remedy where a verified technical error prevented delivery or where the relevant profile had already been removed for serious fraud before the unit was consumed. This is assessed case by case.</p>

<h3>8. Marketplace transactions</h3>
<p>This Policy covers payments made for ${identity.platformName} digital plans, not private payments between Marketplace buyers and sellers. Returns, quality disputes, delivery, warranties, deposits, and refunds for Marketplace goods or services are the responsibility of the transaction parties under their agreement and applicable law. Report scams through the safety tools, but a report does not guarantee recovery.</p>

<h3>9. Trials, promotions, coupons, and plan changes</h3>
<p>Displayed trial and promotion terms control eligibility, conversion, and expiry; unused value is not cash and coupons are not retroactive. Plan changes, proration, and credits apply only as disclosed or legally required.</p>

<h3>10. How to request a refund</h3>
<p>Contact <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a> promptly and include:</p>
<ul>
  <li>the account email or phone number in masked form sufficient to identify the account;</li>
  <li>order ID, payment reference, purchase date, amount, currency, and purchase channel;</li>
  <li>the plan or entitlement affected and a clear explanation of the issue;</li>
  <li>relevant screenshots or provider receipts with sensitive credentials removed; and</li>
  <li>the requested remedy.</li>
</ul>
<p>We may request identity or account-control verification to prevent fraudulent refunds. Requests submitted to the wrong channel may be redirected. Delay can limit our ability to retrieve payment records, but statutory periods remain unaffected.</p>

<h3>11. Review and outcomes</h3>
<p>Review may result in a full or partial refund, entitlement credit, subscription extension, technical correction, or a reasoned decline, depending on delivery, use, evidence, and legal rights.</p>
<p>Approved refunds are sent through the original payment route where possible. Bank, store, and provider processing times are outside our control. Taxes and third-party charges are refunded only when recoverable or legally required.</p>

<h3>12. Chargebacks and payment disputes</h3>
<p>Contact support first where safe so we can investigate duplicate, missing, or unauthorized transactions. If you submit a chargeback, the payment provider may temporarily reverse funds and request evidence of acceptance, activation, usage, communication, and account ownership. We may suspend disputed entitlements while the case is open.</p>
<p>Fraudulent chargebacks, altered receipts, or repeated payment abuse can result in account restriction and recovery action. A legitimate chargeback right is not restricted by this paragraph.</p>

<h3>13. Account suspension or deletion</h3>
<p>Policy termination does not normally refund consumed benefits. Permanent discontinuation of a paid feature may qualify for a proportionate remedy.</p>

<h3>14. Law and contact</h3>
<p>Nothing in this Policy waives a non-excludable consumer remedy under ${identity.governingLaw}. Disputes are subject to the dispute terms in our Terms &amp; Conditions and the competent forum associated with ${identity.jurisdiction}. For payment support contact <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a>; legal notices may be sent to <a href="mailto:${identity.legalEmail}">${identity.legalEmail}</a>.</p>
      `
    ),
    document(
      "content_policy",
      "Content Moderation Policy",
      `
<h2>Content Moderation Policy</h2>
<p>This Policy explains how <strong>${identity.platformName}</strong> addresses user-generated content and conduct across Member Profiles, the Community Feed, comments, photos, videos, Connections, Chat, Marketplace, Matrimony, verification, reports, and related Services. It should be read with the Community Guidelines and Terms &amp; Conditions.</p>
<p>Our goals are to reduce unlawful or harmful material, protect member expression and privacy, enforce product rules consistently, and provide meaningful review where practical. Moderation is risk-based and cannot prevent or identify every violation.</p>

<h3>1. Content within scope</h3>
<ul>
  <li>profile names, biographies, photographs, verification claims, community details, and Matrimony fields;</li>
  <li>Feed posts, comments, reactions, hashtags, links, photos, videos, and metadata;</li>
  <li>Chat text, media, or context submitted in a report;</li>
  <li>Marketplace and Matrimony activity, reports, account signals, appeals, and supplied evidence.</li>
</ul>
<p>We do not routinely read every private Chat. Relevant messages may be reviewed when a participant reports them, when automated security signals identify a serious threat, or when lawful process requires access.</p>

<h3>2. Prohibited and restricted categories</h3>
<table>
  <thead><tr><th>Category</th><th>Examples and approach</th></tr></thead>
  <tbody>
    <tr><td><strong>Illegal and exploitative content</strong></td><td>Child exploitation, trafficking, credible threats, non-consensual intimate imagery, illegal goods, and serious criminal facilitation are removed and may be preserved or reported.</td></tr>
    <tr><td><strong>Harassment and hate</strong></td><td>Threats, dehumanizing attacks, repeated targeting, sexual harassment, doxxing, and abuse based on protected or vulnerable characteristics are prohibited.</td></tr>
    <tr><td><strong>Fraud and deception</strong></td><td>Impersonation, forged verification, phishing, romance scams, fake Marketplace listings, advance-fee fraud, malware, and account takeover attempts are prohibited.</td></tr>
    <tr><td><strong>Intellectual property</strong></td><td>Content subject to a sufficiently detailed rights complaint may be disabled while ownership, licence, exceptions, and counter-information are assessed.</td></tr>
    <tr><td><strong>Spam and manipulation</strong></td><td>Bulk messaging, fake engagement, coordinated reporting, scraping, repetitive promotion, bots, and attempts to bypass distribution or plan controls may be restricted.</td></tr>
  </tbody>
</table>

<h3>3. Detection sources</h3>
<p>Potential violations may be identified through member reports, admin observation, support tickets, rights-holder notices, payment disputes, trusted safety referrals, lawful requests, and automated signals. Automated systems may detect unusual messaging volume, duplicate media, prohibited terms, suspicious links, account clusters, device anomalies, or prior enforcement matches.</p>
<p>Automated signals are indicators, not proof. Depending on risk, they may trigger distribution limits, a temporary hold, additional verification, or human review. High-risk urgent cases can receive immediate interim action.</p>

<h3>4. Reporting content</h3>
<p>Use in-product reporting where available because it attaches the content reference and relevant context. Choose the closest reason, explain the risk, and avoid editing evidence. For issues that cannot be reported in-product, contact <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a>.</p>
<ul>
  <li>Report immediate danger to appropriate local emergency services first.</li>
  <li>Do not repeatedly report the same content unless material new evidence exists.</li>
  <li>Do not use reports to retaliate, silence criticism, win a Marketplace dispute, or pressure a Matrimony member.</li>
  <li>Reports may not result in the outcome requested when context, evidence, policy, or law does not support it.</li>
</ul>

<h3>5. Review process</h3>
<p>Reviewers may consider the content itself, surrounding conversation, intended audience, caption, language and cultural context, newsworthiness, artistic or educational value, credible risk, account history, target vulnerability, reach, and applicable ${identity.governingLaw}. We may request more information from the reporter, subject, rights holder, or account owner.</p>
<p>Content can be lawful but still violate platform rules, or violate law even if not expressly listed in our policies. We may seek specialist or legal input for difficult cases. To protect security and privacy, we may not disclose internal detection methods or another member’s confidential information.</p>

<h3>6. Possible content actions</h3>
<ul>
  <li><strong>No action:</strong> available evidence does not establish a violation.</li>
  <li><strong>Warning or education:</strong> the member is informed of a lower-severity issue and expected to correct it.</li>
  <li><strong>Label or interstitial:</strong> viewers receive context or a sensitive-content warning.</li>
  <li><strong>Distribution reduction:</strong> content remains accessible in limited contexts but is excluded from recommendation or broad discovery.</li>
  <li><strong>Feature restriction:</strong> commenting, messaging, listing, Matrimony access, uploading, live visibility, or another capability is limited.</li>
  <li><strong>Removal:</strong> content is disabled from active display.</li>
  <li><strong>Preservation:</strong> a protected copy is retained for investigation, appeal, fraud prevention, or legal obligation.</li>
</ul>

<h3>7. Account-level actions</h3>
<p>Serious or repeated violations can result in loss of verification, reduced reach, temporary locks, payment or Subscription Plan holds, device or account verification, suspension, or permanent termination. We may link related accounts for enforcement where evidence indicates common control or evasion.</p>
<p>Urgent threats, exploitation, organized fraud, or evidence destruction may require action without warning.</p>

<h3>8. Marketplace moderation</h3>
<p>Marketplace review can consider listing legality, category, price anomalies, copied photos, prohibited claims, seller history, payment requests, user reports, and external recall or rights information. We may hide a listing pending proof of ownership, authenticity, safety, licences, or other compliance.</p>
<p>Removal does not determine ownership or resolve a private contract. Buyers and sellers remain responsible for inspection, payment, delivery, taxes, warranties, and disputes. We can preserve and disclose relevant records when legally justified.</p>

<h3>9. Matrimony moderation</h3>
<p>Matrimony review may address false age or marital status, impersonation, stolen photos, coercion, harassment, dowry demands, financial solicitation, intimate-image abuse, repeated unwanted contact, or unsafe offline conduct connected to a platform introduction. Admin verification is limited and does not establish compatibility or truth of every field.</p>
<blockquote>A profile’s continued availability is not a safety certification. Members must independently verify claims and report concerning behaviour, including conduct that occurs after communication moves off-platform.</blockquote>

<h3>10. Chat, privacy, and blocking</h3>
<p>When a Chat is reported, reviewers may inspect enough surrounding conversation to understand context, including attachments and metadata. Access is limited to legitimate moderation needs. Blocking can restrict future interaction but does not automatically delete prior messages from either participant’s account or from preserved evidence.</p>

<h3>11. Intellectual-property notices</h3>
<p>A rights notice should identify the protected work, the allegedly infringing material and its location, the complaining party’s contact details and authority, a good-faith statement, and a signature. Send notices to <a href="mailto:${identity.legalEmail}">${identity.legalEmail}</a>. We may forward sufficient notice details to the uploader and invite correction or counter-information.</p>

<h3>12. Appeals</h3>
<p>Where offered, the affected account may request review by following the notice instructions or contacting <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a>. An appeal should identify the action, explain the claimed error, and provide new or missing context. We may uphold, modify, or reverse the action.</p>
<p>We may limit abusive, repetitive, legally prohibited, or security-sensitive appeals.</p>

<h3>13. Transparency and confidentiality</h3>
<p>We may publish aggregate safety information but generally protect reporter identity, detection methods, private evidence, and disciplinary records.</p>

<h3>14. Law-enforcement and emergency requests</h3>
<p>Valid, scoped requests should go to <a href="mailto:${identity.legalEmail}">${identity.legalEmail}</a>. We may preserve or disclose information as required by ${identity.governingLaw} or imminent serious harm.</p>

<h3>15. Policy integrity and updates</h3>
<p>Moderators and admins must follow role-based access, confidentiality, conflict-of-interest, and audit requirements. Abuse of moderation access is prohibited. This Policy may evolve based on service changes, emerging harms, operational learning, and ${identity.governingLaw}. Questions about the policy may be sent to <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a>; legal disputes are associated with ${identity.jurisdiction}, subject to mandatory rights.</p>
      `
    ),
    document(
      "account_deletion",
      "Account Deletion & Data Retention Policy",
      `
<h2>Account Deletion &amp; Data Retention Policy</h2>
<p>This Policy explains how a member may delete an account on <strong>${identity.platformName}</strong>, what deletion affects, and why limited information may be retained. It applies to Member Profiles, Community Feed activity, Connections, Chat, Marketplace, Matrimony, Subscription Plans, Push Notifications, verification, reports, blocks, and admin moderation records.</p>
<blockquote><strong>Deletion is permanent after any stated recovery window.</strong> Before requesting deletion, save information you need, complete or document Marketplace transactions, cancel external subscriptions, and consider whether active safety or payment disputes require records.</blockquote>

<h3>1. How to request deletion</h3>
<p>Use the in-app account deletion option where available or email <a href="mailto:${identity.privacyEmail}">${identity.privacyEmail}</a> from the contact method associated with the account. If you cannot access that method, provide enough non-sensitive information for us to verify account control. Support questions may be sent to <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a>.</p>
<p>Never send passwords, one-time codes, complete payment credentials, or unnecessary identity documents by email. We may pause a request if identity cannot be reasonably verified, the account is compromised, another person lacks authority, or deletion would prejudice an active legal requirement.</p>

<h3>2. Before deletion</h3>
<ul>
  <li><strong>Subscriptions:</strong> cancel recurring billing through the original app store or payment provider. Account deletion does not guarantee cancellation of an externally administered subscription.</li>
  <li><strong>Marketplace:</strong> finish, cancel, or preserve evidence of pending transactions and disputes. Deletion does not extinguish obligations between buyer and seller.</li>
  <li><strong>Matrimony:</strong> save any information you are legally entitled to retain and notify relevant contacts if necessary. Other members may retain communications already received.</li>
  <li><strong>Data copy:</strong> request or use an available export before deletion. An export may omit information that would reveal another person’s rights, confidential security details, or legally restricted material.</li>
</ul>

<h3>3. Processing stages</h3>
<table>
  <thead><tr><th>Stage</th><th>What generally happens</th></tr></thead>
  <tbody>
    <tr><td><strong>Request and verification</strong></td><td>We authenticate the requester, identify the account, disclose any required next step, and record the request.</td></tr>
    <tr><td><strong>Restriction</strong></td><td>Login or profile visibility may be disabled and Push Notification routing may stop while deletion is processed.</td></tr>
    <tr><td><strong>Active-system deletion</strong></td><td>Eligible profile fields and directly controlled content are removed or de-identified from normal product access.</td></tr>
  </tbody>
</table>

<h3>4. Account and Member Profile</h3>
<p>Deletion disables normal login and removes or de-identifies eligible registration details, Member Profile fields, profile media, preferences, Connections, discoverability, and active Push Notification tokens. The former username or an internal identifier may be reserved to prevent impersonation, fraud, or accidental reassignment.</p>
<p>Verification badges are removed. Limited verification audit information may be retained to prove the review, prevent repeated fraud, meet legal duties, or defend claims. Verification files no longer needed for those purposes are deleted or de-identified according to applicable controls.</p>

<h3>5. Community Feed content</h3>
<p>Posts, comments, and uploaded photos or videos directly controlled by the deleting account are generally removed from active display or disconnected from the identity. Some content may remain where:</p>
<ul>
  <li>another member independently reposted, quoted, downloaded, or captured it;</li>
  <li>removal would impair another member’s lawful record or the integrity of a conversation, in which case authorship may be de-identified;</li>
  <li>the content is evidence in a report, appeal, Marketplace dispute, intellectual-property claim, or legal matter;</li>
  <li>retention is required by ${identity.governingLaw}; or</li>
  <li>the content has been transformed into aggregated information that no longer reasonably identifies the member.</li>
</ul>

<h3>6. Chat and recipient copies</h3>
<p>Deletion does not necessarily erase messages or media already delivered to other participants. Recipients may continue to see a de-identified conversation or their own copy, and may have taken screenshots or exports outside our control. We may remove the deleting member’s profile link while preserving conversation continuity and safety evidence.</p>
<p>If a message contains content that violates policy or unlawfully exposes personal information, report it separately. Account deletion alone is not a substitute for an urgent content-removal or safety request.</p>

<h3>7. Marketplace data</h3>
<p>Active listings are disabled. Transaction communications, order references, payment evidence, listing snapshots, dispute records, tax or accounting data, and fraud signals may be retained for legitimate legal, financial, and safety purposes. Private Marketplace obligations survive deletion, and ${identity.platformName} cannot cancel a member-to-member agreement merely by deleting an account.</p>

<h3>8. Matrimony data</h3>
<p>The Matrimony profile is removed from discovery, pending interests may become unavailable, and unused access tied solely to the deleted account may be forfeited under plan terms. Members who previously received contact details or messages may retain them independently. Reports involving coercion, fraud, harassment, dowry demands, identity deception, or other safety concerns may be preserved.</p>

<h3>9. Subscription and payment records</h3>
<p>Deletion does not itself produce a refund. Subscription and payment records may be retained to reconcile purchases, fulfil accounting and tax obligations, process refunds, answer chargebacks, detect abuse, and establish legal rights. The Refund &amp; Cancellation Policy applies to monetary remedies.</p>
<p>If an app store or payment provider controls renewal, cancel through that provider separately. ${identity.platformName} may not be able to cancel a contract attached to an external store account.</p>

<h3>10. Reports, blocks, moderation, and security</h3>
<p>Reports submitted by or about an account, block relationships, warning history, enforcement decisions, device or network security signals, and appeal records may be retained after deletion where necessary to protect members, prevent evasion, audit admin action, or respond to legal claims. Access is limited based on role and purpose.</p>
<p>We may retain a one-way identifier, prohibited-account marker, or limited contact hash to prevent a terminated person from immediately recreating an account. Such records are not used to restore the public profile.</p>

<h3>11. Retention criteria</h3>
<table>
  <thead><tr><th>Record type</th><th>Reason retention may continue</th></tr></thead>
  <tbody>
    <tr><td><strong>Financial and subscription</strong></td><td>Accounting, tax, reconciliation, refund, chargeback, and fraud obligations.</td></tr>
    <tr><td><strong>Safety and moderation</strong></td><td>Member protection, appeals, repeat-abuse prevention, legal claims, and admin accountability.</td></tr>
    <tr><td><strong>Security logs</strong></td><td>Incident detection, account takeover investigation, abuse prevention, and system integrity.</td></tr>
    <tr><td><strong>Legal preservation</strong></td><td>Valid authority request, litigation hold, statutory duty, or establishment and defence of rights.</td></tr>
  </tbody>
</table>
<p>We select retention periods based on purpose, sensitivity, risk, limitation periods, technical architecture, and ${identity.governingLaw}. Retained data is isolated or access-restricted where appropriate and deleted or de-identified when the purpose expires.</p>

<h3>12. Pending disputes and preservation</h3>
<p>Deletion does not override lawful preservation for fraud, disputes, safety, payment, IP, security, or court matters. Public access may still be disabled while evidence is isolated.</p>

<h3>13. Backups, caches, and search results</h3>
<p>Protected backup and cache copies expire on normal cycles. External search engines, archives, recipient devices, and websites remain outside our control.</p>

<h3>14. Deactivation versus deletion</h3>
<p>Deactivation may hide a profile for later return; deletion is permanent after any disclosed recovery period.</p>

<h3>15. Requests concerning particular content</h3>
<p>You may request correction or removal of specific personal information under ${identity.governingLaw} by contacting <a href="mailto:${identity.privacyEmail}">${identity.privacyEmail}</a>.</p>

<h3>16. Appeals and complaints</h3>
<p>Request reconsideration of a limited deletion at <a href="mailto:${identity.privacyEmail}">${identity.privacyEmail}</a>; confidential safety or third-party details may be withheld.</p>

<h3>17. Governing terms</h3>
<p>This Policy is interpreted under ${identity.governingLaw}. Privacy complaints and related proceedings are subject to competent authorities and courts associated with ${identity.jurisdiction}, except where mandatory law provides another right or forum. We may update the Policy to reflect technical, legal, or service changes.</p>
      `
    ),
    document(
      "safety",
      "Safety & Abuse Reporting Policy",
      `
<h2>Safety &amp; Abuse Reporting Policy</h2>
<p><strong>${identity.platformName}</strong> provides reporting, blocking, verification, and admin moderation tools to reduce harm across the Community Feed, Member Profiles, Connections, Chat, Marketplace, Matrimony, Subscription Plans, and related interactions. This Policy explains how to use those tools and what members should expect.</p>
<blockquote><strong>Immediate danger:</strong> ${identity.platformName} is not an emergency service and does not continuously monitor reports or Chat. If someone faces immediate danger, a medical emergency, self-harm risk, violence, or a crime in progress, contact the appropriate local emergency service or authority first.</blockquote>

<h3>1. Safety is a shared responsibility</h3>
<p>No verification, moderation, or reporting system can guarantee another person’s identity, intentions, product quality, or future behaviour. Members should limit sensitive information, secure their accounts, independently verify claims, use safe meeting and payment practices, and tell trusted people about concerning interactions.</p>

<h3>2. Conduct to report</h3>
<ul>
  <li>credible threats, stalking, coercion, extortion, blackmail, or encouragement of self-harm;</li>
  <li>harassment, hate, sexual abuse, repeated unwanted contact, or attempts to bypass a block;</li>
  <li>child exploitation, grooming, trafficking, forced marriage, or other danger to a vulnerable person;</li>
  <li>Marketplace scams, stolen or prohibited goods, counterfeit products, unsafe meeting pressure, or payment deception;</li>
  <li>Matrimony deception about identity, age or marital status, dowry demands, financial solicitation, coercion, or intimate-image threats;</li>
  <li>privacy abuse, impersonation, phishing, dangerous misinformation, or admin and reporting misconduct.</li>
</ul>

<h3>3. How to report</h3>
<p>Use the report control on the profile, post, comment, Chat, Marketplace listing, or Matrimony profile whenever available. In-product reports preserve a content reference and are generally easier to investigate. If unavailable, contact <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a>.</p>
<p>Include a concise description, dates, usernames, listing or content references, and unedited screenshots where safe. Do not endanger yourself to collect evidence. Do not forward illegal intimate or child-exploitation material; report its location without downloading or redistributing it.</p>

<h3>4. Choosing urgent action</h3>
<table>
  <thead><tr><th>Situation</th><th>Recommended first step</th></tr></thead>
  <tbody>
    <tr><td><strong>Immediate physical danger or medical crisis</strong></td><td>Contact appropriate local emergency responders; move to safety if possible.</td></tr>
    <tr><td><strong>Account compromise</strong></td><td>Change credentials, secure email and phone access, revoke suspicious sessions, and contact support.</td></tr>
    <tr><td><strong>Financial fraud</strong></td><td>Stop payment if possible, contact the bank or payment provider, preserve records, and report the account or listing.</td></tr>
    <tr><td><strong>Intimate-image abuse or blackmail</strong></td><td>Do not pay or send more material; preserve threats safely, report urgently, and seek appropriate specialist or authority help.</td></tr>
  </tbody>
</table>

<h3>5. Blocking</h3>
<p>Blocking is a personal safety and boundary tool. It may limit profile visibility, Connection requests, Chat, comments, or other interactions between accounts. Product architecture, shared content, public posts, Marketplace transactions, group contexts, or alternate accounts can limit its effect.</p>
<p>A block does not delete messages already delivered, cancel a transaction, recover money, or notify emergency services. Attempts to bypass a block through another account or channel can lead to enforcement. Report the conduct as well as blocking when there is a threat, fraud, or serious policy violation.</p>

<h3>6. What happens after a report</h3>
<p>Reports may be prioritized based on credible immediacy, severity, target vulnerability, available evidence, and reach. Admins may review the reported item, surrounding context, account and enforcement history, relevant Chat, Marketplace or Matrimony records, and security signals. We may ask follow-up questions.</p>
<ul>
  <li>We may take no action when evidence does not establish a violation.</li>
  <li>We may warn, label, limit distribution, remove content, restrict a feature, withdraw verification, or suspend an account.</li>
  <li>We may temporarily freeze activity while identity, payment, ownership, or safety evidence is checked.</li>
  <li>We may preserve information for appeals, fraud prevention, legal claims, or valid authority requests.</li>
  <li>We may refer suspected serious offences or imminent harm to competent authorities where justified under ${identity.governingLaw}.</li>
</ul>

<h3>7. Reporter privacy and fairness</h3>
<p>We generally do not identify reporters to the reported member. Absolute confidentiality cannot be guaranteed where disclosure is required by law, necessary to investigate fairly, or obvious from the circumstances. We disclose only what is reasonably necessary.</p>
<p>The reported person may receive notice of the rule and content involved and may have an appeal opportunity. They are not entitled to confidential detection methods, another person’s private data, or information that would create retaliation risk.</p>

<h3>8. Good-faith reporting</h3>
<p>Reports must be honest. Do not fabricate evidence, crop material to reverse its meaning, coordinate mass reports, threaten reports for leverage, or retaliate after a Marketplace disagreement or Matrimony rejection. Misuse can result in warning, reporting restrictions, suspension, or termination.</p>
<p>A good-faith report is not a violation merely because it is unconfirmed. Provide new evidence if circumstances change rather than repeatedly filing identical reports.</p>

<h3>9. Marketplace safety</h3>
<ul>
  <li>Verify the item, seller, ownership, condition, total price, and return terms independently.</li>
  <li>Avoid unusual advance payment, gift cards, cryptocurrency pressure, remote-device access, or requests for one-time codes.</li>
  <li>Meet during daylight in a safe public place, bring another person where appropriate, and do not disclose your home address unnecessarily.</li>
  <li>Inspect goods before completing payment and preserve listing, receipt, and communication records.</li>
  <li>For regulated goods or services, confirm licences and legal requirements yourself.</li>
</ul>
<p>${identity.platformName} is a venue and cannot guarantee recovery of a private payment. Contact the payment provider or appropriate authority promptly if fraud is suspected.</p>

<h3>10. Matrimony safety</h3>
<blockquote>Verification and profile approval are limited trust signals, not criminal, financial, medical, employment, education, family, or marital-status background checks. Never rely on them as a substitute for independent verification.</blockquote>
<ul>
  <li>Take time before sharing phone numbers, addresses, identity documents, workplace details, financial information, or private family records.</li>
  <li>Use video or other reasonable verification, involve trusted family or friends if desired, and meet first in a safe public place.</li>
  <li>Tell someone where you are going, arrange independent transport, and maintain control of your phone and documents.</li>
  <li>Never send money or valuables because of an emergency story, travel request, investment opportunity, visa claim, dowry request, or promise of marriage.</li>
  <li>Stop contact and report pressure, secrecy demands, inconsistent identity claims, sexual coercion, or attempts to obtain intimate media.</li>
</ul>
<p>${identity.platformName} does not guarantee a match, response, meeting, engagement, marriage, compatibility, or member conduct. Decisions about relationships remain entirely with consenting adults.</p>

<h3>11. Photos, videos, and intimate-image safety</h3>
<p>Assume any media sent to another person can be copied. Avoid including identity documents, precise location, home details, children, or sensitive background information unless necessary and safe. Review camera and gallery selections before upload.</p>
<p>Never create, request, threaten to share, or distribute intimate imagery without explicit consent. If threatened, do not pay or send additional content. Preserve the threat without further distributing the image, block where safe, submit an urgent report, and contact appropriate specialist support or authorities.</p>

<h3>12. Location, camera, and notification safety</h3>
<p>Grant device permissions only as needed, prefer approximate location, avoid publishing live locations, and hide sensitive lock-screen previews. Push delivery is not an emergency channel.</p>

<h3>13. Account security</h3>
<ul>
  <li>Use a unique password and protect the email and mobile number used for recovery.</li>
  <li>Never disclose passwords, personal identification numbers, or one-time codes—even to someone claiming to be an admin.</li>
  <li>Update devices, review unfamiliar sessions, and avoid suspicious links, files, QR codes, and remote access.</li>
</ul>
<p>Official support will not ask you to transfer money to avoid suspension or to reveal an authentication code. Suspected impersonation of ${identity.platformName} should be reported to <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a>.</p>

<h3>14. Medical, self-harm, and crisis situations</h3>
<p>Community members and admins are not substitutes for qualified medical, mental-health, legal, or emergency professionals. If someone expresses immediate intent to self-harm or harm others, contact appropriate emergency or crisis resources and provide accurate location information if known and lawful. Do not promise secrecy when life may be at risk.</p>
<p>Reports are reviewed as operational capacity allows and may not be seen in real time. ${identity.platformName} does not diagnose conditions, prescribe treatment, dispatch responders, or guarantee intervention.</p>

<h3>15. Offline conduct</h3>
<p>Serious offline harm connected to the platform may affect account access when supported by reliable evidence.</p>

<h3>16. Appeals and updates</h3>
<p>A member affected by enforcement may appeal using the notice process or by emailing <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a> with the action reference and relevant new context. We may uphold, modify, or reverse the action. Safety-sensitive information can remain confidential.</p>
<p>This Policy is interpreted with ${identity.governingLaw}; legal notices should be directed to <a href="mailto:${identity.legalEmail}">${identity.legalEmail}</a>, and relevant proceedings are associated with ${identity.jurisdiction} subject to mandatory law. We may update safety procedures as threats, technology, and the Services evolve.</p>
      `
    )
  ];
}
