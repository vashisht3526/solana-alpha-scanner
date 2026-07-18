import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(NumberedCanvas, self).__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_number(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_page_number(self, page_count):
        if self._pageNumber == 1:
            return  # Suppress page numbers/headers on cover page
            
        self.saveState()
        self.setFont("Helvetica", 9)
        self.setFillColor(colors.HexColor("#4B5563"))
        
        # Draw Header
        self.drawString(54, 750, "SOLANA ALPHA SCANNER — TECHNICAL SYSTEM BLUEPRINT")
        self.setStrokeColor(colors.HexColor("#E5E7EB"))
        self.setLineWidth(0.5)
        self.line(54, 742, 558, 742)
        
        # Draw Footer
        page_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(558, 45, page_text)
        self.drawString(54, 45, "CONFIDENTIAL — STRICTLY FOR SYSTEM UNDERSTANDING")
        self.line(54, 58, 558, 58)
        self.restoreState()

def create_system_report(filename="Solana_Alpha_Scanner_Blueprint.pdf"):
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        rightMargin=54,
        leftMargin=54,
        topMargin=72,
        bottomMargin=72
    )

    styles = getSampleStyleSheet()
    
    # Custom styles
    primary_color = colors.HexColor("#0F172A")    # Slate 900
    secondary_color = colors.HexColor("#0D9488")  # Teal 600
    accent_color = colors.HexColor("#14F195")     # Solana Green
    dark_gray = colors.HexColor("#1F2937")        # Gray 800
    light_gray = colors.HexColor("#F9FAFB")       # Gray 50
    border_gray = colors.HexColor("#E5E7EB")      # Gray 200

    title_style = ParagraphStyle(
        'CoverTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=30,
        leading=36,
        textColor=primary_color,
        spaceAfter=15
    )

    subtitle_style = ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=13,
        leading=18,
        textColor=secondary_color,
        spaceAfter=30
    )

    h1_style = ParagraphStyle(
        'Header1',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=primary_color,
        spaceBefore=18,
        spaceAfter=10,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'Header2',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=secondary_color,
        spaceBefore=12,
        spaceAfter=6,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body',
        parent=styles['BodyText'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=dark_gray,
        spaceAfter=8
    )

    code_style = ParagraphStyle(
        'CodeStyle',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#1E293B"),
        backColor=colors.HexColor("#F1F5F9"),
        borderColor=colors.HexColor("#CBD5E1"),
        borderWidth=0.5,
        borderPadding=6,
        spaceBefore=8,
        spaceAfter=8
    )

    bullet_style = ParagraphStyle(
        'Bullet',
        parent=body_style,
        leftIndent=15,
        firstLineIndent=-10,
        spaceAfter=4
    )

    story = []

    # =========================================================================
    # COVER PAGE
    # =========================================================================
    story.append(Spacer(1, 150))
    story.append(Paragraph("SOLANA ALPHA SCANNER", title_style))
    story.append(Paragraph("SYSTEM ARCHITECTURE & TECHNICAL BLUEPRINT", subtitle_style))
    
    # Decorative line
    d_table = Table([[""]], colWidths=[504], rowHeights=[4])
    d_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), secondary_color),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ('TOPPADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(d_table)
    story.append(Spacer(1, 30))

    metadata_text = """
    <b>Prepared on:</b> July 16, 2026<br/>
    <b>Architecture:</b> Pure Client-Side dApp with IndexedDB Persistence<br/>
    <b>External Providers:</b> Helius RPC & DexScreener APIs<br/>
    <b>Target Network:</b> Solana Mainnet-Beta<br/>
    """
    story.append(Paragraph(metadata_text, body_style))
    story.append(PageBreak())

    # =========================================================================
    # SECTION 1: ARCHITECTURAL OVERVIEW
    # =========================================================================
    story.append(Paragraph("1. Architectural Overview", h1_style))
    story.append(Paragraph(
        "The Solana Alpha Scanner is a client-side Web3 application engineered to detect high-potential tokens, "
        "analyze coordinated wallet behavior (syndicates), and execute automated paper-trading strategies. "
        "Crucially, the system runs 100% in the user's browser memory (Client-Side) for privacy and decentralized data storage. "
        "It stores all historical states, scanner results, settings, and trade logs locally within the browser sandboxed IndexedDB storage.",
        body_style
    ))
    
    story.append(Paragraph("Key architectural pillars:", h2_style))
    story.append(Paragraph("• <b>Decentralized Browser Sandbox:</b> Zero backend databases. The browser CPU runs the detection loops and stores states locally, avoiding API credential leak hazards.", bullet_style))
    story.append(Paragraph("• <b>Enhanced Data Feeds:</b> Employs Helius RPC for on-chain queries and DexScreener REST APIs for token profile analytics.", bullet_style))
    story.append(Paragraph("• <b>PumpPortal WS Integration:</b> Subscribes to real-time pump.fun token creations to enable immediate token tracking before liquidity moves to secondary markets.", bullet_style))
    story.append(Spacer(1, 10))

    # =========================================================================
    # SECTION 2: FILE BRICK-BY-BRICK ROLES
    # =========================================================================
    story.append(Paragraph("2. System Components (File-by-File)", h1_style))
    
    components_data = [
        ["Component", "Description / Responsibilities"],
        ["index.html & index.css", "Unified responsive frontend interface styling based on CSS Grid, customized tabs, real-time trade logs, and toggles."],
        ["app.js", "Coordinates the UI loop, orchestrates Helius signature scans, handles progress bars, and manages filter logic."],
        ["db.js", "Manages the local IndexedDB database (SolanaAlphaScanner v3) structure, handling persistence of trades, tokens, settings, and wallet clusters."],
        ["sniper-engine.js", "Handles token discovery (boosted, profiles, search, real-time WebSocket) and implements the 10-point scoring algorithm."],
        ["cluster-intel.js", "Analyzes wallet relationships by establishing shared funding linkages and coordinative token-purchasing clusters (syndicate detection)."],
        ["paper-trade.js", "Executes paper trading simulations with adjustable latency, slippage, stop-loss, take-profit, and whale-shadow exit safety."],
        ["radar.js", "Provides momentum tracking and classifies tokens into Runner, Flip, or Trap pattern categories."]
    ]
    
    t = Table(components_data, colWidths=[140, 364])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), primary_color),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,0), 9),
        ('BACKGROUND', (0,1), (-1,-1), light_gray),
        ('TEXTCOLOR', (0,1), (-1,-1), dark_gray),
        ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
        ('FONTSIZE', (0,1), (-1,-1), 8.5),
        ('GRID', (0,0), (-1,-1), 0.5, border_gray),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(t)
    story.append(Spacer(1, 15))

    # =========================================================================
    # SECTION 3: REAL-TIME LAUNCH DISCOVERY ENGINE
    # =========================================================================
    story.append(Paragraph("3. Real-Time Launch Discovery Engine", h1_style))
    story.append(Paragraph(
        "To capture viral launches immediately upon mint, the discovery engine uses a dual pipeline:",
        body_style
    ))
    
    story.append(Paragraph("A. Real-Time Pump.fun Stream", h2_style))
    story.append(Paragraph(
        "Directly connects to PumpPortal's low-latency feed:<br/>"
        "<code><b>wss://pumpportal.fun/api/data</b></code><br/>"
        "Sending subscription payload: <code><b>{\"method\": \"subscribeNewToken\"}</b></code><br/>"
        "The socket streams new mint creation metadata (mint address, ticker, name, creator) instantly as they occur on the Solana network, allowing analysis long before the bonding curve completes.",
        body_style
    ))

    story.append(Paragraph("B. DexScreener Fallback Strategies", h2_style))
    story.append(Paragraph(
        "1. <b>Boosted Listings Polling:</b> Periodically queries paid boosts: <code>/token-boosts/top/v1</code>.<br/>"
        "2. <b>Latest Profiles Polling:</b> Queries newly completed profiles: <code>/token-profiles/latest/v1</code>.<br/>"
        "3. <b>Keyword Search:</b> Dynamically searches DexScreener queries for viral tickers (e.g. 'cat', 'pump') to catch organic setups.",
        body_style
    ))
    story.append(Spacer(1, 10))

    # =========================================================================
    # SECTION 4: WEIGHTED SCORING ALGORITHM (10 SIGNALS)
    # =========================================================================
    story.append(Paragraph("4. The Weighted Scoring Algorithm", h1_style))
    story.append(Paragraph(
        "The engine scores tokens between 0 and 100 based on 10 weighted metrics defined in <code>sniper-engine.js</code>:",
        body_style
    ))

    score_data = [
        ["Signal Name", "Max Pts", "Metric Details & Thresholds"],
        ["Age Sweet Spot", "10 pts", "Ideal creation age: 5m to 1hr (10 pts). 1h to 6h gets 7 pts. 6h to 24h gets 3 pts."],
        ["Volume/MCap Ratio", "15 pts", "Ratio of 24h volume to market cap. Ratio >= 2.0 = 15 pts. Ratio >= 0.5 = 10 pts. Ratio >= 0.1 = 4.5 pts."],
        ["Liquidity Health", "10 pts", "Liquidity >= $50K = 10 pts. >= $10K = 7 pts. >= $3K = 5 pts. >= $100 = 3 pts."],
        ["Price Momentum", "10 pts", "Uptrend check: 5m change > 5% and 1h change > 20% = 10 pts. Both positive = 6 pts. Flat = 2 pts."],
        ["Holder Growth", "8 pts", "Recent transactions proxy: >= 100 trades/hour = 8 pts. >= 30 = 5.6 pts. >= 10 = 3.2 pts."],
        ["Buy/Sell Ratio", "10 pts", "Buys to sells ratio in the last hour. Ratio >= 3.0 = 10 pts. >= 1.5 = 6 pts. >= 1.0 = 3 pts."],
        ["Smart Money Match", "15 pts", "Count of known alpha wallets purchasing: >= 3 matches = 15 pts. >= 1 match = 7.5 pts."],
        ["Market Cap Zone", "12 pts", "The sweet spot zone: $10K-$80K (12 pts). $80K-$300K (8.4 pts). $3K-$10K (7.2 pts)."],
        ["DexScreener Boost", "5 pts", "If the token is actively boosted/paying for DexScreener visibility = 5 pts."],
        ["Anti-Rug Security", "5 pts", "Deducts 3 pts if top holder owns > 20% supply; deducts 2 pts if < 3 unique holders. Suspicious honeypot checks are ran."]
    ]

    t_score = Table(score_data, colWidths=[120, 60, 324])
    t_score.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), secondary_color),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,0), 9),
        ('BACKGROUND', (0,1), (-1,-1), light_gray),
        ('TEXTCOLOR', (0,1), (-1,-1), dark_gray),
        ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
        ('FONTSIZE', (0,1), (-1,-1), 8.5),
        ('GRID', (0,0), (-1,-1), 0.5, border_gray),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(t_score)
    story.append(Spacer(1, 15))

    # =========================================================================
    # SECTION 5: ANTI-MANIPULATION & SYNDICATE DETECTION
    # =========================================================================
    story.append(Paragraph("5. Anti-Manipulation & Syndicate Detection", h1_style))
    story.append(Paragraph(
        "insiders coordinate volume to trap retail. The scanner employs 5 active guards:",
        body_style
    ))
    story.append(Paragraph("1. <b>Single Token Filter:</b> Blacklists wallets that trade only 1 specific token, indicating a temporary insider address.", bullet_style))
    story.append(Paragraph("2. <b>100% Win Rate Blocker:</b> Flags and ignores wallets with 100% win rates, which are typically frontrunning or HFT bots.", bullet_style))
    story.append(Paragraph("3. <b>HFT Bot Filter:</b> Filters out wallets executing more than 20 transactions per minute.", bullet_style))
    story.append(Paragraph("4. <b>One-Hit Wonder Filter:</b> Flags wallets getting >80% of their historical profit from a single lucky trade.", bullet_style))
    story.append(Paragraph("5. <b>Syndicate Clustering (cluster-intel.js):</b> Links wallets together if they share funding sources (same SOL provider wallet) or trade the same micro-cap tokens synchronously. Cooperative buys are flagged as 'Cluster Buys' to alert users to coordinated pumps.", bullet_style))
    story.append(Spacer(1, 10))

    # =========================================================================
    # SECTION 6: PAPER & COPY TRADING ENGINE
    # =========================================================================
    story.append(Paragraph("6. Paper & Copy Trading Engine", h1_style))
    story.append(Paragraph(
        "Located in <code>paper-trade.js</code>, this engine simulates realistic on-chain trade execution:",
        body_style
    ))
    story.append(Paragraph("• <b>Simulated Latency:</b> Adds a variable delay (200ms to 800ms) to mirror blockchain confirmation times.", bullet_style))
    story.append(Paragraph("• <b>Slippage Modeling:</b> Simulates 0.5% to 3.0% slippage on entry and exit to ensure realistic returns.", bullet_style))
    story.append(Paragraph("• <b>Whale Shadow Exit:</b> An advanced protection feature. If a wallet from the syndicate group that caused the initial entry sells their position, the engine immediately triggers an emergency sell to exit before the retail dump.", bullet_style))
    story.append(Paragraph("• <b>Stop-Loss & Take-Profit:</b> Strict risk limits: SL at -15%, TP at +50% (adjustable in settings).", bullet_style))
    story.append(Paragraph("• <b>Session Recovery:</b> Upon page refresh, positions are loaded from IndexedDB, and the price tracking feeds are automatically re-spawned.", bullet_style))

    # Build the document
    doc.build(story, canvasmaker=NumberedCanvas)

if __name__ == "__main__":
    create_system_report()
    print("Report compiled successfully!")
