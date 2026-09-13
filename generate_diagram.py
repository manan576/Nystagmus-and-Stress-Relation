import os
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import matplotlib.font_manager as fm
import numpy as np

# Set up Font Properties with fallback detection
font_emoji = fm.FontProperties(family='Segoe UI Emoji', size=15)
font_text = fm.FontProperties(family='Segoe UI', size=12.5, weight='bold')
font_title = fm.FontProperties(family='Segoe UI', size=18, weight='heavy')
font_sub = fm.FontProperties(family='Segoe UI', size=10.5, weight='bold')
font_legend = fm.FontProperties(family='Segoe UI', size=8.5, weight='semibold')

# 16:9 Canvas (9600 x 5400 px @ 600 DPI for True 10K Ultra-Sharp Zoom)
fig, ax = plt.subplots(figsize=(16, 9), dpi=600)
fig.patch.set_facecolor('#060913')
ax.set_facecolor('#060913')

ax.set_xlim(0, 100)
ax.set_ylim(0, 56.25)
ax.axis('off')

# Subtle background grid with high-resolution styling
for x in np.linspace(2, 98, 49):
    ax.axvline(x, color='#1e293b', alpha=0.18, lw=0.5, zorder=0)
for y in np.linspace(2, 54, 27):
    ax.axhline(y, color='#1e293b', alpha=0.18, lw=0.5, zorder=0)

# Function to draw wide, clean card with balanced, luminous neon glow
def draw_clean_card(ax, x, y, w, h, name, emoji, border_color, glow_color, bg_color='#0b1120', is_lambda=False):
    # 18-pass smooth Gaussian neon diffusion (balanced luminescence)
    num_passes = 18
    max_spread = 2.4
    for i in range(num_passes, 0, -1):
        spread = (i / num_passes) * max_spread
        normalized_dist = spread / max_spread
        alpha = 0.13 * np.exp(-3.0 * (normalized_dist ** 1.3))
        
        glow_box = patches.FancyBboxPatch(
            (x - spread/2, y - spread/2), w + spread, h + spread,
            boxstyle=patches.BoxStyle("Round", pad=0.35, rounding_size=0.85),
            facecolor=glow_color, edgecolor='none', alpha=float(alpha), zorder=2
        )
        ax.add_patch(glow_box)
    
    # Soft ambient rim highlight
    ambient_rim = patches.FancyBboxPatch(
        (x - 0.1, y - 0.1), w + 0.2, h + 0.2,
        boxstyle=patches.BoxStyle("Round", pad=0.3, rounding_size=0.8),
        facecolor=glow_color, edgecolor='none', alpha=0.18, zorder=2.5
    )
    ax.add_patch(ambient_rim)

    # Main Card Base (Deep Dark Glassmorphism with Crisp Neon Border)
    card = patches.FancyBboxPatch(
        (x, y), w, h,
        boxstyle=patches.BoxStyle("Round", pad=0.3, rounding_size=0.8),
        facecolor=bg_color, edgecolor=border_color, linewidth=2.2, alpha=0.98, zorder=3
    )
    ax.add_patch(card)
    
    # Render Emoji + Name separately to ensure precise typography
    center_y = y + h/2
    if is_lambda:
        # λ symbol using standard font with vibrant neon tint
        ax.text(x + 2.2, center_y, 'λ', fontproperties=font_text,
                color=border_color, fontsize=15, ha='left', va='center', zorder=5)
        ax.text(x + 4.5, center_y, name, fontproperties=font_text,
                color='#ffffff', ha='left', va='center', zorder=5)
    elif emoji:
        ax.text(x + 2.0, center_y, emoji, fontproperties=font_emoji,
                color='#ffffff', ha='left', va='center', zorder=5)
        ax.text(x + 4.8, center_y, name, fontproperties=font_text,
                color='#ffffff', ha='left', va='center', linespacing=1.15, zorder=5)
    else:
        ax.text(x + w/2, center_y, name, fontproperties=font_text,
                color='#ffffff', ha='center', va='center', linespacing=1.15, zorder=5)
    
    return {
        'left': (x - 0.3, center_y),
        'right': (x + w + 0.3, center_y),
        'top': (x + w/2, y + h + 0.3),
        'bottom': (x + w/2, y - 0.3),
        'x': x,
        'y': y,
        'w': w,
        'h': h,
        'y_center': center_y
    }

# Function to draw STRAIGHT orthogonal arrows with balanced neon glow & luminous core
def draw_straight_arrow(ax, p1, p2, color, waypoints=None):
    if waypoints is None:
        xs = [p1[0], p2[0]]
        ys = [p1[1], p2[1]]
    else:
        xs = [p1[0]] + [w[0] for w in waypoints] + [p2[0]]
        ys = [p1[1]] + [w[1] for w in waypoints] + [p2[1]]
    
    # 4-tier balanced neon glow on line strokes
    stroke_passes = [
        (10.0, 0.04),
        (7.0, 0.09),
        (4.8, 0.18),
        (3.0, 0.35),
    ]
    for lw, alpha in stroke_passes:
        ax.plot(xs, ys, color=color, lw=lw, alpha=alpha, zorder=1, solid_capstyle='round', solid_joinstyle='round')
    
    # Crisp saturated neon tube line
    ax.plot(xs, ys, color=color, lw=2.0, alpha=0.98, zorder=2, solid_capstyle='round', solid_joinstyle='round')
    
    # Subtle inner bright core highlight
    ax.plot(xs, ys, color='#ffffff', lw=0.6, alpha=0.60, zorder=3, solid_capstyle='round', solid_joinstyle='round')
    
    # Arrowhead at destination with matching soft aura
    end_x, end_y = p2[0], p2[1]
    dx = end_x - xs[-2]
    dy = end_y - ys[-2]
    length = np.hypot(dx, dy)
    if length > 0:
        ux, uy = dx/length, dy/length
        ax.annotate('', xy=(end_x, end_y), xytext=(end_x - ux*0.6, end_y - uy*0.6),
                    arrowprops=dict(arrowstyle="-|>", color=color, lw=3.8, mutation_scale=15, alpha=0.25),
                    zorder=3.5)
        ax.annotate('', xy=(end_x, end_y), xytext=(end_x - ux*0.6, end_y - uy*0.6),
                    arrowprops=dict(arrowstyle="-|>", color=color, lw=2.0, mutation_scale=15),
                    zorder=4)

# Function to draw enclosing container box (e.g., AWS Amplify Group)
def draw_group_container(ax, x, y, w, h, title, title_color='#38bdf8', border_color='#0284c7'):
    # Subtle ambient glow around container
    container_glow = patches.FancyBboxPatch(
        (x - 0.5, y - 0.5), w + 1.0, h + 1.0,
        boxstyle=patches.BoxStyle("Round", pad=0.35, rounding_size=1.2),
        facecolor=border_color, edgecolor='none', alpha=0.04, zorder=1
    )
    ax.add_patch(container_glow)
    
    # Main container frame (glassmorphic group boundary)
    container = patches.FancyBboxPatch(
        (x, y), w, h,
        boxstyle=patches.BoxStyle("Round", pad=0.3, rounding_size=1.0),
        facecolor='#070c18', edgecolor=border_color, linewidth=1.5, linestyle='--', alpha=0.7, zorder=1.5
    )
    ax.add_patch(container)
    
    # Title on top of the container box
    ax.text(x + w/2, y + h + 1.8, title, fontproperties=font_sub, color=title_color, ha='center', va='center', zorder=4)

# ==========================================
# 1. HEADER (CLEAN & MINIMAL)
# ==========================================
ax.text(4, 51.5, 'NeuroTrial Architecture Overview', fontproperties=font_title, color='#ffffff', ha='left', va='center', zorder=4)
ax.text(96, 51.5, 'AWS Serverless & Bedrock GenAI', fontproperties=font_sub, color='#ff9900', ha='right', va='center', zorder=4)
ax.plot([4, 96], [48.5, 48.5], color='#334155', lw=1.0, alpha=0.5, zorder=2)

# ==========================================
# 2. NODES (WELL-BALANCED SPACIOUS 5-COLUMN LAYOUT)
# ==========================================

# Container Box around Client Portals: AWS Amplify (X: 1.2, Y: 11.5, Width: 15.2, Height: 32.5)
draw_group_container(ax, x=1.2, y=11.5, w=15.2, h=32.5,
                     title='AWS Amplify', title_color='#38bdf8', border_color='#0284c7')

# Column 1: Client Portals inside AWS Amplify (X: 1.8, Width: 14.0) - 2 lines to prevent overflow
c_patient = draw_clean_card(ax, x=1.8, y=34, w=14.0, h=7.5,
                            name='Patient\nPortal', emoji='👤',
                            border_color='#38bdf8', glow_color='#38bdf8')

c_clinician = draw_clean_card(ax, x=1.8, y=14, w=14.0, h=7.5,
                              name='Clinician\nPortal', emoji='🩺',
                              border_color='#34d399', glow_color='#34d399')

# Column 2: AWS Cognito (Identity & RBAC) (X: 19.4, Width: 14.8)
c_cognito = draw_clean_card(ax, x=19.4, y=24, w=14.8, h=7.5,
                            name='AWS Cognito', emoji='🔐',
                            border_color='#a855f7', glow_color='#a855f7')

# Column 3: API Gateway (X: 37.2, Width: 15.2) - 2 lines to prevent overflow
c_apigw = draw_clean_card(ax, x=37.2, y=24, w=15.2, h=7.5,
                          name='AWS API\nGateway', emoji='⚡',
                          border_color='#fb923c', glow_color='#fb923c')

# Column 4 Header: "AWS Lambda Functions"
ax.text(64.5, 46.0, 'AWS Lambda Functions', fontproperties=font_sub, color='#c084fc', ha='center', va='center', zorder=4)

# Column 4: Lambda Functions (X: 55.2, Width: 18.8 - Names without lambda_ prefix)
c_ingest = draw_clean_card(ax, x=55.2, y=37, w=18.8, h=7.0,
                           name='ingest', emoji=None,
                           border_color='#fbbf24', glow_color='#fbbf24', is_lambda=True)

c_query = draw_clean_card(ax, x=55.2, y=24, w=18.8, h=7.0,
                          name='query', emoji=None,
                          border_color='#38bdf8', glow_color='#38bdf8', is_lambda=True)

c_bedrock = draw_clean_card(ax, x=55.2, y=11, w=18.8, h=7.0,
                            name='bedrock_summary', emoji=None,
                            border_color='#f43f5e', glow_color='#f43f5e', is_lambda=True)

# Column 5 Header: "AWS Data & AI Services"
ax.text(87.5, 46.0, 'AWS Data & AI Services', fontproperties=font_sub, color='#34d399', ha='center', va='center', zorder=4)

# Column 5: AWS Cloud Services (X: 79.0, Width: 17.2)
c_s3 = draw_clean_card(ax, x=79.0, y=37, w=17.2, h=7.0,
                       name='AWS S3', emoji='🗄',
                       border_color='#10b981', glow_color='#10b981')

c_ddb = draw_clean_card(ax, x=79.0, y=24, w=17.2, h=7.0,
                        name='AWS DynamoDB', emoji='🗃',
                        border_color='#6366f1', glow_color='#6366f1')

c_ai = draw_clean_card(ax, x=79.0, y=11, w=17.2, h=7.0,
                       name='AWS Bedrock', emoji='🤖',
                       border_color='#ec4899', glow_color='#ec4899')

# ==========================================
# 3. DRAW STRAIGHT ORTHOGONAL ARROWS
# ==========================================

# 1. Patient Portal -> AWS Cognito
mid_x1 = (c_patient['right'][0] + c_cognito['left'][0]) / 2
draw_straight_arrow(ax, c_patient['right'], (c_cognito['left'][0], c_cognito['y_center'] + 1.2),
                    color='#38bdf8',
                    waypoints=[(mid_x1, c_patient['y_center']), (mid_x1, c_cognito['y_center'] + 1.2)])

# 2. Clinician Portal -> AWS Cognito
draw_straight_arrow(ax, c_clinician['right'], (c_cognito['left'][0], c_cognito['y_center'] - 1.2),
                    color='#34d399',
                    waypoints=[(mid_x1, c_clinician['y_center']), (mid_x1, c_cognito['y_center'] - 1.2)])

# 3. AWS Cognito -> API Gateway (JWT / Scoped Authorizer)
draw_straight_arrow(ax, c_cognito['right'], c_apigw['left'], color='#a855f7')

# 4. API Gateway -> 3 Lambdas (Straight orange)
mid_x2 = (c_apigw['right'][0] + c_ingest['left'][0]) / 2
draw_straight_arrow(ax, (c_apigw['right'][0], c_apigw['y_center'] + 1.5), c_ingest['left'],
                    color='#fb923c',
                    waypoints=[(mid_x2, c_apigw['y_center'] + 1.5), (mid_x2, c_ingest['y_center'])])

draw_straight_arrow(ax, c_apigw['right'], c_query['left'], color='#fb923c')

draw_straight_arrow(ax, (c_apigw['right'][0], c_apigw['y_center'] - 1.5), c_bedrock['left'],
                    color='#fb923c',
                    waypoints=[(mid_x2, c_apigw['y_center'] - 1.5), (mid_x2, c_bedrock['y_center'])])

# =========================================================================
# 4. UNIQUE COLOR ARROWS PER LAMBDA (ALL STRAIGHT / ORTHOGONAL)
# =========================================================================

# Gap channels between Column 4 and Column 5 (between ~74.3 and ~78.7)
chan_ingest_ddb = 75.3
chan_bedrock_ddb = 76.5
chan_query_s3 = 77.7

# --- A) lambda_ingest (ALL ELECTRIC AMBER #fbbf24) ---
# 1. lambda_ingest -> AWS S3 (Straight horizontal)
draw_straight_arrow(ax, (c_ingest['right'][0], c_ingest['y_center'] + 0.8), (c_s3['left'][0], c_s3['y_center'] + 0.8),
                    color='#fbbf24')
# 2. lambda_ingest -> AWS DynamoDB (Straight orthogonal step via channel 1)
draw_straight_arrow(ax, (c_ingest['right'][0], c_ingest['y_center'] - 0.8), (c_ddb['left'][0], c_ddb['y_center'] + 1.2),
                    color='#fbbf24',
                    waypoints=[(chan_ingest_ddb, c_ingest['y_center'] - 0.8), (chan_ingest_ddb, c_ddb['y_center'] + 1.2)])

# --- B) lambda_query (ALL NEON CYAN #38bdf8) ---
# 1. lambda_query -> AWS S3 (Straight orthogonal step via channel 3)
draw_straight_arrow(ax, (c_query['right'][0], c_query['y_center'] + 1.0), (c_s3['left'][0], c_s3['y_center'] - 1.0),
                    color='#38bdf8',
                    waypoints=[(chan_query_s3, c_query['y_center'] + 1.0), (chan_query_s3, c_s3['y_center'] - 1.0)])
# 2. lambda_query -> AWS DynamoDB (Straight horizontal)
draw_straight_arrow(ax, (c_query['right'][0], c_query['y_center'] - 0.5), (c_ddb['left'][0], c_ddb['y_center'] - 0.5),
                    color='#38bdf8')

# --- C) lambda_bedrock_summary (ALL HOT PINK #f43f5e) ---
# 1. lambda_bedrock_summary -> AWS DynamoDB (Straight orthogonal step via channel 2)
draw_straight_arrow(ax, (c_bedrock['right'][0], c_bedrock['y_center'] + 0.8), (c_ddb['left'][0], c_ddb['y_center'] - 1.5),
                    color='#f43f5e',
                    waypoints=[(chan_bedrock_ddb, c_bedrock['y_center'] + 0.8), (chan_bedrock_ddb, c_ddb['y_center'] - 1.5)])
# 2. lambda_bedrock_summary -> AWS Bedrock (Straight horizontal, strictly NO S3)
draw_straight_arrow(ax, (c_bedrock['right'][0], c_bedrock['y_center'] - 0.8), (c_ai['left'][0], c_ai['y_center'] - 0.8),
                    color='#f43f5e')

# ==========================================
# 5. FOOTER LEGEND
# ==========================================
ax.plot([4, 96], [5.0, 5.0], color='#334155', lw=1.0, alpha=0.5, zorder=2)
ax.text(4, 2.8, 'NeuroTrial — Decentralized Autonomic Neurological Clinical Trial Platform',
        fontproperties=font_legend, color='#64748b', ha='left', va='center', zorder=4)

def draw_legend_dot(ax, x, y, color, label):
    dot = patches.Circle((x, y), 0.5, facecolor=color, edgecolor='none', zorder=4)
    ax.add_patch(dot)
    ax.text(x + 1.2, y, label, fontproperties=font_legend, color='#94a3b8', ha='left', va='center', zorder=4)

draw_legend_dot(ax, 46, 2.8, '#fbbf24', 'ingest (S3 + DynamoDB)')
draw_legend_dot(ax, 64, 2.8, '#38bdf8', 'query (S3 + DynamoDB)')
draw_legend_dot(ax, 82, 2.8, '#f43f5e', 'bedrock_summary (DynamoDB + Bedrock)')

# Save final high-resolution images (9600 x 5400 px @ 600 DPI) and infinite-zoom Vector SVG
os.makedirs('assets', exist_ok=True)
plt.savefig('assets/trialsync_straight_diagram.png', dpi=600, bbox_inches='tight', facecolor=fig.get_facecolor(), pad_inches=0.2)
plt.savefig('assets/trialsync_highlevel_diagram.jpg', dpi=600, bbox_inches='tight', facecolor=fig.get_facecolor(), pad_inches=0.2)
plt.savefig('assets/trialsync_final_architecture_diagram.png', dpi=600, bbox_inches='tight', facecolor=fig.get_facecolor(), pad_inches=0.2)
plt.savefig('assets/neurostress_architecture_diagram.jpg', dpi=600, bbox_inches='tight', facecolor=fig.get_facecolor(), pad_inches=0.2)
plt.savefig('assets/neurotrial_architecture_diagram.png', dpi=600, bbox_inches='tight', facecolor=fig.get_facecolor(), pad_inches=0.2)
plt.savefig('assets/trialsync_architecture_diagram.svg', bbox_inches='tight', facecolor=fig.get_facecolor(), pad_inches=0.2)
plt.savefig('assets/neurotrial_architecture_diagram.svg', bbox_inches='tight', facecolor=fig.get_facecolor(), pad_inches=0.2)
plt.close()

print("Ultra-high resolution 10K diagram with AWS Cognito generated successfully!")
