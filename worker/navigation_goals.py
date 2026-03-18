"""
navigation_goals.py - Site-specific Skyvern navigation goal templates

This module contains navigation goal templates for different recruitment platforms.
Each template is tailored to the specific UI and flow of the platform.

Usage:
    from navigation_goals import get_navigation_goal

    goal = get_navigation_goal(
        domain="webcruiter.no",
        action="apply",
        profile_data={...},
        credentials={...}
    )
"""

from typing import Optional


# ============================================
# SITE DETECTION
# ============================================

def detect_site_type(domain: str) -> str:
    """Detect the type of recruitment site based on domain."""
    domain = domain.lower()

    # Known platforms - use specific domain patterns to avoid false positives
    # Order matters: more specific patterns first
    if 'webcruiter.no' in domain or 'webcruiter.com' in domain:
        return 'webcruiter'
    elif 'easycruit.com' in domain:
        return 'easycruit'
    elif 'jobylon.com' in domain:
        return 'jobylon'
    elif 'teamtailor.com' in domain:
        return 'teamtailor'
    elif 'lever.co' in domain or domain.startswith('jobs.lever.'):
        return 'lever'
    elif 'recman.no' in domain or 'recman.page' in domain:
        return 'recman'
    elif 'cvpartner.com' in domain:
        return 'cvpartner'
    elif 'reachmee.com' in domain:
        return 'reachmee'
    elif 'varbi.com' in domain:
        return 'varbi'
    elif 'hrmanager.no' in domain:
        return 'hrmanager'
    elif 'finn.no' in domain:
        return 'finn'
    elif 'nav.no' in domain or 'arbeidsplassen' in domain:
        return 'nav'
    elif 'adecco.com' in domain or 'adecco.no' in domain:
        return 'adecco'
    else:
        return 'generic'


# ============================================
# REGISTRATION GOALS
# ============================================

def get_registration_goal(domain: str, profile_data: dict, email: str, password: str) -> str:
    """Get site-specific registration navigation goal."""
    site_type = detect_site_type(domain)

    if site_type == 'webcruiter':
        return _webcruiter_registration(profile_data, email, password)
    elif site_type == 'easycruit':
        return _easycruit_registration(profile_data, email, password)
    elif site_type == 'jobylon':
        return _jobylon_registration(profile_data, email, password)
    elif site_type == 'teamtailor':
        return _teamtailor_registration(profile_data, email, password)
    elif site_type == 'recman':
        return _recman_registration(profile_data, email, password)
    elif site_type == 'reachmee':
        return _reachmee_registration(profile_data, email, password)
    else:
        return _generic_registration(profile_data, email, password)


def _webcruiter_registration(profile_data: dict, email: str, password: str) -> str:
    return f"""
GOAL: Register for a new account on Webcruiter recruitment platform.

IMPORTANT RULES:
1. Fill ONLY fields that have data provided. DO NOT guess or make up information.
2. If a required field has no data, STOP and report it.
3. Phone numbers should include country code (+47 for Norway).

REGISTRATION DATA:
- Email: {email}
- Password: {password}
- First Name: {profile_data.get('first_name', '')}
- Last Name: {profile_data.get('last_name', '')}
- Phone: {profile_data.get('phone', '')}

PHASE 1: COOKIE HANDLING
1. If cookie popup appears, click "Godta alle" or "Aksepter".

PHASE 2: FIND REGISTRATION
2. Look for "Opprett bruker", "Ny bruker", or "Registrer deg som arbeidssøker".
3. If on login page, look for "Registrer deg" or "Opprett konto" link.
4. Click to go to registration form.

PHASE 3: FILL REGISTRATION FORM
5. Enter email address: {email}
6. Enter password: {password}
7. Confirm password if there's a second field: {password}
8. Enter first name (Fornavn): {profile_data.get('first_name', '')}
9. Enter last name (Etternavn): {profile_data.get('last_name', '')}
10. Enter phone number (Telefon): {profile_data.get('phone', '')} (with +47 if needed)

PHASE 4: ACCEPT TERMS
11. Check the terms and conditions checkbox.
12. Check GDPR/privacy checkbox if present.

PHASE 5: SUBMIT
13. Click "Registrer", "Opprett bruker", or similar button.
14. Wait for confirmation or verification message.

VERIFICATION CHECK:
15. Check if email verification is required.
16. Report any verification requirements.

REPORT:
- registration_successful: true if account created
- needs_email_verification: true if verification email sent
- filled_fields: {{}} with all fields that were filled
- missing_fields: [] with any required fields that couldn't be filled
"""


def _easycruit_registration(profile_data: dict, email: str, password: str) -> str:
    return f"""
GOAL: Register for a new account on Easycruit recruitment platform.

REGISTRATION DATA:
- Email: {email}
- Password: {password}
- Full Name: {profile_data.get('full_name', '')}
- Phone: {profile_data.get('phone', '')}

PHASE 1: COOKIE HANDLING
1. If cookie popup appears, click "Accept", "Godta alle", or close button.

PHASE 2: FIND REGISTRATION
2. Look for "Create profile", "Opprett profil", "Register", or "Sign up".
3. May redirect to company-specific subdomain - that's expected.
4. Click registration link/button.

PHASE 3: FILL FORM
5. Enter email: {email}
6. Enter password: {password}
7. Confirm password: {password}
8. Enter name: {profile_data.get('full_name', '')}
9. Enter phone: {profile_data.get('phone', '')}
10. Select country "Norge" or "Norway" if dropdown present.

PHASE 4: SUBMIT
11. Accept terms checkbox.
12. Click submit button.
13. Check for verification requirements.

REPORT all results including verification needs.
"""


def _jobylon_registration(profile_data: dict, email: str, password: str) -> str:
    return f"""
GOAL: Register on Jobylon recruitment platform.

REGISTRATION DATA:
- Email: {email}
- Password: {password}
- Name: {profile_data.get('full_name', '')}
- Phone: {profile_data.get('phone', '')}

PHASE 1: COOKIE HANDLING
1. Accept cookies if popup appears.

PHASE 2: FIND REGISTRATION
2. Look for "Sign up" button (usually in top navigation).
3. Ignore social login options (LinkedIn, Google) - use email registration.
4. Click email registration option.

PHASE 3: FILL FORM
5. Jobylon typically has a single-page form:
   - Email: {email}
   - Password: {password}
   - Name: {profile_data.get('full_name', '')}
6. Fill available fields.

PHASE 4: SUBMIT
7. Click "Create account" or "Sign up".
8. Wait for confirmation.

NOTE: Jobylon has modern UI - buttons are usually clearly visible.
"""


def _teamtailor_registration(profile_data: dict, email: str, password: str) -> str:
    return f"""
GOAL: Register on Teamtailor candidate portal.

REGISTRATION DATA:
- Email: {email}
- Password: {password}
- Name: {profile_data.get('full_name', '')}

PHASE 1: COOKIE HANDLING
1. Accept cookies.

PHASE 2: FIND REGISTRATION
2. Look for "Create account" in top navigation or login area.
3. Skip LinkedIn import option - use manual entry.
4. Click to go to registration form.

PHASE 3: FILL FORM
5. Enter email: {email}
6. Enter password: {password}
7. Enter name if field exists.

PHASE 4: SUBMIT
8. Accept terms.
9. Submit registration.
10. Check for email verification.
"""


def _recman_registration(profile_data: dict, email: str, password: str) -> str:
    return f"""
GOAL: Register on Recman recruitment platform.

NOTE: Recman is a Norwegian system, use Norwegian terms.

REGISTRATION DATA:
- Email: {email}
- Password: {password}
- Full Name: {profile_data.get('full_name', '')}
- First Name: {profile_data.get('first_name', '')}
- Last Name: {profile_data.get('last_name', '')}
- Phone: {profile_data.get('phone', '')}

PHASE 1: COOKIE HANDLING
1. Click "Godta" or "Aksepter" on cookie popup.

PHASE 2: FIND REGISTRATION
2. Look for "Registrer deg", "Opprett bruker", or "Bli kandidat".
3. Click registration link.

PHASE 3: FILL FORM
4. Recman often has multi-step registration:
   Step 1: Email and password
   Step 2: Personal info (name, phone)
   Step 3: CV upload (optional)

5. Fill each step:
   - Email: {email}
   - Password: {password}
   - First name: {profile_data.get('first_name', '')}
   - Last name: {profile_data.get('last_name', '')}
   - Phone: {profile_data.get('phone', '')}

PHASE 4: COMPLETE
6. Skip optional steps like CV upload for now.
7. Click "Fullfør" or "Registrer".
8. Check for email verification.
"""


def _reachmee_registration(profile_data: dict, email: str, password: str) -> str:
    return f"""
GOAL: Register on ReachMee recruitment platform.

REGISTRATION DATA:
- Email: {email}
- Password: {password}
- Name: {profile_data.get('full_name', '')}
- Phone: {profile_data.get('phone', '')}

PHASE 1: COOKIE HANDLING
1. Accept cookies.

PHASE 2: FIND REGISTRATION
2. Look for "Create account", "Register", or "Sign up".
3. May be on attract.reachmee.com subdomain.
4. Click registration option.

PHASE 3: FILL FORM
5. Enter email: {email}
6. Enter password: {password}
7. Enter name: {profile_data.get('full_name', '')}
8. Enter phone if field exists.

PHASE 4: SUBMIT
9. Accept terms.
10. Submit registration.
"""


def _generic_registration(profile_data: dict, email: str, password: str) -> str:
    return f"""
GOAL: Register for a new account on this recruitment website.

IMPORTANT: This is a generic registration flow. Adapt to what you see on the page.

REGISTRATION DATA:
- Email: {email}
- Password: {password}
- Full Name: {profile_data.get('full_name', '')}
- First Name: {profile_data.get('first_name', '')}
- Last Name: {profile_data.get('last_name', '')}
- Phone: {profile_data.get('phone', '')}
- Country: {profile_data.get('country', 'Norge')}

PHASE 1: COOKIE HANDLING
1. Accept any cookie popups: "Godta alle", "Accept all", "OK", "I agree".

PHASE 2: FIND REGISTRATION
2. Common registration links:
   - "Register", "Sign up", "Create account"
   - "Registrer deg", "Opprett konto", "Ny bruker"
3. If on login page, look for registration link below login form.
4. Click to go to registration.

PHASE 3: FILL FORM
5. Fill available fields with provided data:
   - Email field: {email}
   - Password field: {password}
   - Confirm password: {password}
   - Name fields: Use full_name or first_name/last_name
   - Phone: {profile_data.get('phone', '')}
   - Country dropdown: Select "Norge" or "Norway"

PHASE 4: TERMS & SUBMIT
6. Check required checkboxes (terms, GDPR).
7. Click submit button.
8. Wait for result.

PHASE 5: VERIFICATION CHECK
9. Check if page shows:
   - "Verification email sent" → needs_email_verification = true
   - "Confirm your phone" → needs_sms_verification = true
   - "Registration complete" → registration_successful = true

REPORT all fields that were filled and any that couldn't be filled.
"""


# ============================================
# APPLICATION GOALS
# ============================================

def get_application_goal(
    domain: str,
    profile_data: dict,
    cover_letter: str,
    credentials: Optional[dict] = None,
    resume_url: Optional[str] = None
) -> str:
    """Get site-specific application navigation goal."""
    site_type = detect_site_type(domain)

    if site_type == 'webcruiter':
        return _webcruiter_application(profile_data, cover_letter, credentials, resume_url)
    elif site_type == 'easycruit':
        return _easycruit_application(profile_data, cover_letter, credentials, resume_url)
    elif site_type == 'jobylon':
        return _jobylon_application(profile_data, cover_letter, credentials, resume_url)
    elif site_type == 'finn':
        return _finn_application(profile_data, cover_letter, credentials)
    else:
        return _generic_application(profile_data, cover_letter, credentials, resume_url)


def _webcruiter_application(
    profile_data: dict,
    cover_letter: str,
    credentials: Optional[dict],
    resume_url: Optional[str]
) -> str:
    login_phase = ""
    if credentials:
        login_phase = f"""
PHASE 2: LOGIN
3. Look for "Logg inn" button/link.
4. Enter email: {credentials.get('email', '')}
5. Enter password from payload.
6. Click "Logg inn".
7. Wait for login to complete.
"""
    else:
        login_phase = """
PHASE 2: CONTINUE WITHOUT LOGIN (if possible)
3. If login is required, report requires_registration = true.
4. Otherwise, continue to application form.
"""

    extra_fields = ""
    if profile_data.get('birth_date'):
        extra_fields += f"\n- Birth Date / Fødselsdato: {profile_data['birth_date']}"
    if profile_data.get('street'):
        extra_fields += f"\n- Address / Adresse: {profile_data['street']}, {profile_data.get('postal_code', '')} {profile_data.get('city', '')}"
    if profile_data.get('nationality'):
        extra_fields += f"\n- Nationality: {profile_data['nationality']}"

    return f"""
GOAL: Submit job application on Webcruiter.

LOADING OVERLAY HANDLING (applies to ALL phases):
IMPORTANT: Webcruiter pages often show a loading overlay ("Siden laster...", "Loading...", a spinner,
or a semi-transparent overlay covering the page). If you see such an overlay:
1. Do NOT try to click through it or interact with elements behind it.
2. WAIT 5 seconds, then check if the page has finished loading.
3. If still loading after 3 waits (15 seconds total), try scrolling down or clicking
   on an empty area of the page body to dismiss the overlay.
4. Only proceed with form interaction once the overlay is gone.

APPLICATION DATA:
- Name: {profile_data.get('full_name', '')}
- Email: {profile_data.get('email', '')}
- Phone: {profile_data.get('phone', '')}{extra_fields}
- Cover Letter: (in payload)
- Resume URL: {resume_url or 'Not provided'}

PHASE 1: COOKIE HANDLING
1. Click "Godta alle" if cookie popup appears.
2. Close any modals.

{login_phase}

PHASE 3: FIND APPLICATION FORM
8. Look for "Søk på stillingen", "Apply", or "Send søknad" button.
9. Click to open application form.

PHASE 4: FILL APPLICATION
10. Fill form fields using APPLICATION DATA and navigation_payload:
    - Name/Navn: {profile_data.get('full_name', '')}
    - Email/E-post: {profile_data.get('email', '')}
    - Phone/Telefon: {profile_data.get('phone', '')}
    - Birth date/Fødselsdato: Use birth_date from data if field exists
    - Address fields: Use street, postal_code, city from data
    - Cover Letter/Søknadstekst: Use 'cover_letter' from navigation_payload.
      CRITICAL: This is a RICH TEXT EDITOR (TinyMCE/CKEditor), NOT a regular input field.
      Do NOT try to use input_text on <span> elements — it WILL fail.

      Step A: CLICK on the white text editing area below the formatting toolbar (bold/italic/underline buttons).
              This may be inside an <iframe> — if so, click inside the iframe body.
              Or it may be a <div contenteditable="true"> — click on it.
              Wait for a blinking cursor to appear.

      Step B: After clicking and seeing the cursor, type the cover letter text.
              If input_text fails on the clicked element, try using the element
              WITHOUT specifying element_id to type into the currently focused area.

      If the cover letter field cannot be filled after 2 attempts, SKIP IT
      and continue with the rest of the form. Do not retry more than twice.
    - Any other field: Check navigation_payload for matching data
    - Work experience dates (Fra/Til / From/To):
      IMPORTANT: If a work experience "Til" (To) date field is empty in the payload
      or endDate is empty, this means CURRENT POSITION.
      Look for a checkbox like "Nåværende stilling" / "Nåværende" / "Current position"
      and CHECK IT instead of filling a date. Do NOT type "Nåværende" as text in a date field —
      it will cause a validation error.
      If no such checkbox exists, leave the "Til" date field EMPTY.
11. Upload CV/Resume if file upload field exists and resume_url provided:
    IMPORTANT: Do NOT get stuck on CV upload. If it fails twice, move on to the next section.
    Webcruiter CV sections are often COLLAPSED by default and use custom upload widgets.

    Step A: Look for a "CV" or "Dokumenter" section header. If collapsed, CLICK to expand it.

    Step B: Try to find and click an upload button:
       - Look for "Last opp fil" / "Velg fil" / "Upload" / "Last opp" button
       - Click it.

    Step C: If that opens a file chooser dialog, use upload_file with resume_url from navigation_payload.

    Step D: If upload_file fails with "No file chooser dialog":
       - Look for ANY <input type="file"> element on the page, including HIDDEN ones.
         These are often invisible (display:none or opacity:0) but still functional.
       - Try upload_file directly on that <input type="file"> element.

    Step E: If ALL upload attempts fail after 2 tries total, SKIP the CV upload entirely
       and continue to the next section. The cover letter and other form fields are
       more important than the CV file — do NOT retry endlessly.
12. If cover letter upload field exists, paste the cover_letter text.

PHASE 5: SUBMIT
13. Check required checkboxes.
14. Click "Send søknad" or "Submit".
15. Wait for confirmation.

COVER LETTER TEXT:
{cover_letter[:500]}...
"""


def _easycruit_application(
    profile_data: dict,
    cover_letter: str,
    credentials: Optional[dict],
    resume_url: Optional[str]
) -> str:
    login_phase = ""
    if credentials:
        login_phase = f"""
PHASE 2: LOGIN
3. Find login form.
4. Enter email: {credentials.get('email', '')}
5. Enter password.
6. Submit login.
"""

    return f"""
GOAL: Submit job application on Easycruit.

APPLICATION DATA:
- Name: {profile_data.get('full_name', '')}
- Email: {profile_data.get('email', '')}
- Phone: {profile_data.get('phone', '')}

PHASE 1: COOKIE HANDLING
1. Accept cookies.

{login_phase}

PHASE 3: APPLICATION FORM
7. Easycruit forms are usually multi-step.
8. Fill each step with provided data.
9. Use cover letter from payload for motivation text.
10. Upload CV if required.

PHASE 4: SUBMIT
11. Review application.
12. Submit.

COVER LETTER:
{cover_letter[:500]}...
"""


def _jobylon_application(
    profile_data: dict,
    cover_letter: str,
    credentials: Optional[dict],
    resume_url: Optional[str]
) -> str:
    return f"""
GOAL: Submit job application on Jobylon.

APPLICATION DATA:
- Name: {profile_data.get('full_name', '')}
- Email: {profile_data.get('email', '')}
- Phone: {profile_data.get('phone', '')}

PHASE 1: COOKIES
1. Accept cookies.

PHASE 2: APPLY
2. Click "Apply" or "Søk" button.
3. Jobylon has simple forms - fill:
   - Name
   - Email
   - Phone
   - Cover letter/motivation

PHASE 3: SUBMIT
4. Upload CV if required.
5. Submit application.

COVER LETTER:
{cover_letter[:500]}...
"""


def _finn_application(
    profile_data: dict,
    cover_letter: str,
    credentials: Optional[dict]
) -> str:
    """FINN Enkel Søknad - special handling."""
    if credentials:
        return f"""
GOAL: Submit FINN Enkel Søknad application.

PHASE 1: LOGIN
1. Accept cookies (Schibsted popup).
2. Enter email: {credentials.get('email', '')}
3. Click "Neste".
4. Enter password.
5. Handle 2FA if prompted.
6. Complete login.

PHASE 2: APPLICATION
7. Fill application form:
   - Name: {profile_data.get('full_name', '')}
   - Email: {profile_data.get('email', '')}
   - Phone: {profile_data.get('phone', '')}
   - Message: (cover letter from payload)

PHASE 3: SUBMIT
8. Check GDPR checkbox.
9. Click "Send søknad".

COVER LETTER:
{cover_letter[:500]}...
"""
    else:
        return f"""
GOAL: Submit FINN Enkel Søknad application.

NOTE: FINN requires login. Credentials not provided - this will likely fail.

PHASE 1: COOKIES
1. Accept Schibsted cookie popup.

PHASE 2: LOGIN REQUIRED
2. FINN Enkel Søknad requires authentication.
3. If login form appears, report requires_registration = true.

COVER LETTER:
{cover_letter[:500]}...
"""


def _generic_application(
    profile_data: dict,
    cover_letter: str,
    credentials: Optional[dict],
    resume_url: Optional[str]
) -> str:
    login_phase = ""
    if credentials:
        login_phase = f"""
PHASE 2: LOGIN (if required)
3. If login form appears, use:
   - Email: {credentials.get('email', '')}
   - Password: from payload
4. Complete login and continue.
"""
    else:
        login_phase = """
PHASE 2: CONTINUE WITHOUT LOGIN
3. If login is required, report requires_registration = true.
4. Otherwise, proceed to application.
"""

    birth_date = profile_data.get('birth_date', '')
    nationality = profile_data.get('nationality', '')
    gender = profile_data.get('gender', '')
    street = profile_data.get('street', '')
    postal_code = profile_data.get('postal_code', '')
    city = profile_data.get('city', '')
    country = profile_data.get('country', 'Norge')
    driver_license = profile_data.get('driver_license', '')

    extra_data = ""
    if birth_date:
        extra_data += f"\n- Birth Date / Fødselsdato: {birth_date}"
    if nationality:
        extra_data += f"\n- Nationality / Nasjonalitet: {nationality}"
    if gender:
        extra_data += f"\n- Gender / Kjønn: {gender}"
    if street:
        extra_data += f"\n- Street / Adresse: {street}"
    if postal_code:
        extra_data += f"\n- Postal Code / Postnummer: {postal_code}"
    if city:
        extra_data += f"\n- City / Sted: {city}"
    if country:
        extra_data += f"\n- Country / Land: {country}"
    if driver_license:
        extra_data += f"\n- Driver License / Førerkort: {driver_license}"

    return f"""
GOAL: Submit job application on this recruitment website.

LOADING OVERLAY HANDLING (applies to ALL phases):
IMPORTANT: Many recruitment sites show a loading overlay ("Siden laster...", "Loading...", a spinner,
or a semi-transparent overlay covering the page). If you see such an overlay:
1. Do NOT try to click through it or interact with elements behind it.
2. WAIT 5 seconds, then check if the page has finished loading.
3. If still loading after 3 waits (15 seconds total), try scrolling down or clicking
   on an empty area of the page body to dismiss the overlay.
4. Only proceed with form interaction once the overlay is gone.

APPLICATION DATA:
- Full Name: {profile_data.get('full_name', '')}
- First Name: {profile_data.get('first_name', '')}
- Last Name: {profile_data.get('last_name', '')}
- Email: {profile_data.get('email', '')}
- Phone: {profile_data.get('phone', '')}{extra_data}
- Resume URL: {resume_url or 'Not provided'}

PHASE 1: COOKIE HANDLING
1. Accept cookies: "Godta alle", "Accept", "OK".
2. Close any popups.

{login_phase}

PHASE 3: FIND APPLICATION FORM
5. Look for apply buttons:
   - "Apply", "Søk", "Send søknad"
   - "Søk på stillingen", "Apply now"
6. Click to open form.

PHASE 4: FILL APPLICATION
7. Fill all form fields using the APPLICATION DATA above:
   - Name fields: Use full_name or first/last name
   - Email: {profile_data.get('email', '')}
   - Phone: {profile_data.get('phone', '')}
   - Birth date / Fødselsdato: Use birth_date from data if field exists
   - Address / Adresse: Use street, postal code, city from data
   - Nationality / Gender: Use from data if fields exist
   - Cover Letter / Motivation / Søknadstekst: Use 'cover_letter' text from navigation_payload.
     WARNING: If this field has a formatting toolbar, it is a rich text editor.
     Do NOT use input_text on <span> elements — it will fail.
     Instead: CLICK the editable area first (inside <iframe> or <div contenteditable="true">),
     wait for cursor, then type. If fill fails twice, skip this field and continue.
   - Any other field: Check navigation_payload for matching data
8. CV/Resume upload (if file upload field exists and resume_url is provided):
   IMPORTANT: Do NOT get stuck on CV upload. If it fails twice, move on.
   Step A: Look for an upload button ("Last opp fil", "Velg fil", "Upload", "Choose file") and click it.
   Step B: If a file chooser dialog opens, use upload_file with resume_url from navigation_payload.
   Step C: If upload_file fails with "No file chooser dialog", look for ANY <input type="file">
      element on the page, including HIDDEN ones (display:none, opacity:0). Try upload_file
      directly on that <input type="file"> element.
   Step D: If ALL upload attempts fail after 2 tries total, SKIP the CV upload entirely
      and continue. The cover letter and other fields are more important — do NOT retry endlessly.
   If resume_url is not provided, skip the upload entirely.
9. If there is a cover letter upload field, paste the cover_letter text from payload.

PHASE 5: SUBMIT
10. Check required checkboxes (terms, GDPR).
11. Click submit button.
12. Wait for confirmation.

COVER LETTER TEXT TO USE:
{cover_letter[:500]}...
"""


# ============================================
# MAIN API
# ============================================

def get_navigation_goal(
    domain: str,
    action: str,
    profile_data: dict,
    cover_letter: str = "",
    credentials: Optional[dict] = None,
    email: str = "",
    password: str = "",
    resume_url: Optional[str] = None
) -> str:
    """
    Get the appropriate navigation goal for a given site and action.

    Args:
        domain: The site domain (e.g., 'webcruiter.no')
        action: Either 'register' or 'apply'
        profile_data: User profile data dict
        cover_letter: Cover letter text (for apply)
        credentials: Saved credentials dict (for apply with login)
        email: Registration email (for register)
        password: Registration password (for register)
        resume_url: URL to CV file (for apply)

    Returns:
        Navigation goal string for Skyvern
    """
    if action == 'register':
        return get_registration_goal(domain, profile_data, email, password)
    elif action == 'apply':
        return get_application_goal(domain, profile_data, cover_letter, credentials, resume_url)
    else:
        raise ValueError(f"Unknown action: {action}. Use 'register' or 'apply'.")


# ============================================
# UTILITY FUNCTIONS
# ============================================

def build_memory_section(memory: dict = None, stats: dict = None) -> str:
    """Build a PREVIOUS EXPERIENCE section to inject into navigation goals.

    Args:
        memory: Latest form memory dict from site_form_memory table.
        stats: Aggregated domain stats from get_domain_stats().

    Returns:
        String to append to navigation_goal, or empty string if no memory.
    """
    if not memory:
        return ""

    outcome = memory.get("outcome", "")
    lines = ["\n\n--- PREVIOUS EXPERIENCE ON THIS SITE ---"]

    # Navigation flow
    nav_flow = memory.get("navigation_flow", [])
    if nav_flow and len(nav_flow) > 1:
        truncated = [u[:60] for u in nav_flow[:6]]
        lines.append(f"Navigation flow ({len(nav_flow)} pages): " + " → ".join(truncated))

    # Form fields from successful submission
    form_fields = memory.get("form_fields", [])
    if form_fields and outcome == "success":
        filled = [f for f in form_fields if f.get("was_filled")]
        labels = [f.get("label", f.get("field_name", "?"))[:30] for f in filled if f.get("label") or f.get("field_name")]
        if labels:
            lines.append(f"Form had {len(filled)} fields: {', '.join(labels[:12])}")

    # File upload info
    if memory.get("has_file_upload"):
        method = memory.get("file_upload_method", "unknown")
        element = memory.get("file_upload_element", "")
        if method and method != "failed" and element:
            lines.append(f"File upload: worked via {method} (element: {element[:50]})")
        elif method == "failed":
            lines.append("File upload: FAILED last time. Try <input type='file'> first, skip after 2 attempts.")

    # Rich text editor info
    if memory.get("has_rich_text_editor"):
        method = memory.get("rich_text_method", "unknown")
        if method == "contenteditable":
            lines.append("Cover letter: Uses contenteditable div. Click editable area, then type.")
        elif method == "iframe":
            lines.append("Cover letter: Uses iframe (TinyMCE/CKEditor). Click inside iframe body, then type.")
        elif method == "failed":
            lines.append("Cover letter: Rich text editor FAILED last time. Try iframe body first.")

    # Step count hint
    total_steps = memory.get("total_steps", 0)
    if total_steps and outcome == "success":
        lines.append(f"Last successful submission took {total_steps} steps.")

    # Failure avoidance
    if outcome == "failure":
        reason = memory.get("failure_reason", "")
        if reason:
            lines.append(f"WARNING: Previous attempt FAILED with: {reason}")

    # Stats-based avoidance instructions (Phase 3)
    if stats:
        sc = stats.get("success_count", 0)
        fc = stats.get("failure_count", 0)
        if sc + fc >= 2:
            rate = stats.get("success_rate", 0)
            lines.append(f"Site track record: {sc} successes, {fc} failures ({rate:.0%} rate)")

        for cf in stats.get("common_failures", []):
            if cf["count"] >= 2:
                reason = cf["reason"]
                if reason == "reach_max_steps":
                    lines.append("CRITICAL: Site often exceeds step limits. Focus on essential fields only.")
                elif reason == "magic_link":
                    lines.append("STOP: Site uses magic link login. Report requires_registration=true.")
                elif reason == "login_failed":
                    lines.append("WARNING: Login fails often. If login fails, report immediately.")
                elif "file_upload" in reason:
                    lines.append("WARNING: File upload often fails. Try once, skip if failing.")

    lines.append("--- END PREVIOUS EXPERIENCE ---\n")
    return "\n".join(lines)


def get_supported_sites() -> list:
    """Return list of supported recruitment platforms."""
    return [
        'webcruiter',
        'easycruit',
        'jobylon',
        'teamtailor',
        'lever',
        'recman',
        'cvpartner',
        'reachmee',
        'varbi',
        'hrmanager',
        'finn',
        'nav'
    ]


def is_site_supported(domain: str) -> bool:
    """Check if a site has specific support (vs generic)."""
    site_type = detect_site_type(domain)
    return site_type != 'generic'
