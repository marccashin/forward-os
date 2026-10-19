// FORWARD: If This, Then That: page content as data.
// Extracted from the original PDF's own text (work/gen_content.py). Edit here, then run build.js.
// strayFont: true marks text the original PDF shows in a different font (a later PDF edit); see README.
module.exports = {
  "_source": "Text copied programmatically from orig/guide.pdf (FORWARD: If This, Then That, Oct 2026). Do not retype.",
  "docTitle": "FORWARD: If This, Then That",
  "footer": "FORWARD · If This, Then That · October 2026",
  "cover": {
    "brand": "FORWARD",
    "title": "If This, Then That",
    "intro": "Every automation behind your deals, stage by stage. When you move a deal card in Follow Up Boss, this is what happens on its own, what is now yours to do, and what Concierge and Transactions take care of.",
    "callout": {
      "label": "IF YOU REMEMBER ONE THING",
      "heading": "Move the deal card in Follow Up Boss the moment the stage changes.",
      "text": "Every email, folder, checklist and task in this guide starts from that move. A card left in the wrong column means none of it happens, and the team has no way of knowing your deal moved."
    },
    "teams": [
      {
        "kicker": "SIGNED CLIENT TO CLOSED DEAL",
        "name": "Transactions",
        "text": "With you from the day a client signs to the day the deal closes. If it is signed, dated or has a deadline, it is Transactions.",
        "goLabel": "GO HERE FOR",
        "goText": "Agreements and disclosures, the MLS, contracts to close, SkySlope and Drive files, the ALTA.",
        "contact": "Sofia Burton · transactions@fwrdrealestate.com"
      },
      {
        "kicker": "EVERY CLIENT, EVERY TOUCH",
        "name": "Concierge",
        "text": "The brand, in person. If it shapes how a client feels, or how FORWARD looks in public (photos, video, marketing), it is Concierge.",
        "goLabel": "GO HERE FOR",
        "goText": "Client emails and closing gifts, photo and video, sign install and removal, social posts and marketing, and the 365 day post-closing program. Concierge lets you know when each post-closing touchpoint is yours, so no client goes without your follow-up.",
        "contact": "Abby Lee · concierge@fwrdrealestate.com"
      }
    ]
  },
  "glance": {
    "title": "Stages at a glance",
    "sub": "Every deal moves left to right. Each stage has its own section in this guide.",
    "flows": [
      {
        "label": "LISTINGS",
        "stages": [
          "Appointment Set",
          "Seller Engaged",
          "Listing App. Scheduled",
          "Listing Agreement Signed",
          "Coming Soon",
          "Listed",
          "Pending",
          "Closed This Quarter"
        ],
        "note": "Coming Soon is optional. If a pending listing falls through, the deal card moves to Back on the Market."
      },
      {
        "label": "BUYERS",
        "stages": [
          "Appointment Set",
          "Buyer Engaged",
          "15 Min Pre-Qual Complete",
          "BA Signed",
          "Actively Showing",
          "Pending",
          "Closed This Quarter"
        ],
        "note": null
      }
    ]
  },
  "sections": [
    {
      "title": "Listings",
      "intro": "Each stage shows what happens on its own the moment you move the card, then what is yours, what Concierge does and what Transactions does.",
      "stages": [
        {
          "num": 1,
          "title": "Appointment Set",
          "trigger": "You change the Follow Up Boss lead stage to Appointment Set (lead type Seller or Buyer/Seller)",
          "automatic": [
            {
              "text": "Follow Up Boss starts your action plan “Seller Appointment Set: Listing Appointment Prep Checklist”."
            },
            {
              "text": "Operations, Transactions and Concierge are added to the Follow Up Boss lead as collaborators, so all three can see it."
            },
            {
              "text": "A note is added to your Follow Up Boss lead record: make sure every decision maker can attend the listing appointment."
            }
          ],
          "you": [
            {
              "text": "Create a Follow Up Boss deal card in the Sellers pipeline at Seller Engaged. This automatically creates the listing card in FORWARD OS."
            },
            {
              "text": "In FORWARD OS, open that listing and fill out the Pre-Listing section for this property."
            },
            {
              "text": "Schedule the listing appointment for a time every decision maker can attend."
            },
            {
              "text": "Add the appointment to your calendar and invite the sellers and any agent attending with you."
            },
            {
              "text": "Send the “Listing Appointment Confirmation” email. Do not skip this."
            },
            {
              "text": "In FORWARD OS: confirm all Pre-Listing information is accurate, set the Campaign Generator settings and generate the campaign."
            },
            {
              "text": "Review the Seller Packet in FORWARD OS. Print and bind it with your Listing Presentation, or send both to the seller ahead of time."
            }
          ],
          "concierge": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "transactions": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "page": 2
        },
        {
          "num": 2,
          "title": "Seller Engaged",
          "trigger": "You create the Follow Up Boss deal card in the Sellers pipeline",
          "automatic": [
            {
              "text": "A listing card for this property is created in FORWARD OS under your name."
            }
          ],
          "you": [
            {
              "text": "Put the property address in the Follow Up Boss deal card's name field, not the seller's name. FORWARD OS uses it as the listing's address."
            },
            {
              "text": "Slide the Follow Up Boss deal card to Listing App. Scheduled once the appointment is booked."
            }
          ],
          "concierge": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "transactions": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "page": 2
        },
        {
          "num": 3,
          "title": "Listing App. Scheduled",
          "trigger": "You slide the Follow Up Boss deal card to Listing App. Scheduled",
          "automatic": [
            {
              "text": "Email to Transactions: “Listing Agreement Needed”."
            },
            {
              "text": "Follow Up Boss starts the Listing Appointment Prep Checklist, if it is not already running from Appointment Set."
            }
          ],
          "you": [
            {
              "text": "Review the sample Listing Agreement from Transactions before the appointment, so you can walk the seller through it."
            },
            {
              "text": "After the appointment, slide the Follow Up Boss deal card to Listing App. Complete."
            },
            {
              "text": "Next day: change the Follow Up Boss lead stage to Intent to Sell or Nurture, based on how the appointment went."
            },
            {
              "text": "When the seller is ready to move forward: add the tag FWRD Seller Onboarding to the Follow Up Boss lead record. This starts onboarding."
            }
          ],
          "concierge": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "transactions": [
            {
              "text": "Drafts a sample Listing Agreement PDF and sends it to you to review with the seller at the appointment."
            }
          ],
          "page": 3
        },
        {
          "num": 4,
          "title": "Tag: FWRD Seller Onboarding",
          "trigger": "You add the tag FWRD Seller Onboarding to the Follow Up Boss lead record",
          "automatic": [
            {
              "text": "Follow Up Boss starts your “Seller Onboarding” action plan."
            },
            {
              "text": "A note is added to your Follow Up Boss lead record: go to FORWARD OS, Agent Tools, and fill out the Listing Agreement and Disclosure Request."
            }
          ],
          "you": [
            {
              "text": "In FORWARD OS, go to Agent Tools and fill out the Listing Agreement and Disclosure Request."
            },
            {
              "text": "Review and approve the Listing Agreement and disclosures PDF that Transactions sends you, so Transactions can send it to the sellers for signatures."
            },
            {
              "text": "Next day: follow up with the sellers if the Listing Agreement and disclosures have not been signed."
            },
            {
              "text": "Only after the Listing Agreement and disclosures are signed: slide the Follow Up Boss deal card to Listing Agreement Signed and change the Follow Up Boss lead stage to Pre-Listing."
            }
          ],
          "concierge": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "transactions": [
            {
              "text": "Prepares the Listing Agreement and disclosures from your request in FORWARD OS."
            },
            {
              "text": "Sends you the PDF of the Listing Agreement and disclosures to review and approve. Nothing goes to the sellers before you approve."
            },
            {
              "text": "Once you approve, sends the Listing Agreement and disclosures to the sellers for signatures."
            }
          ],
          "page": 3
        },
        {
          "num": 5,
          "title": "Listing Agreement Signed",
          "trigger": "You slide the Follow Up Boss deal card to Listing Agreement Signed",
          "automatic": [
            {
              "text": "Email to Concierge and Transactions: “Order Sign Install”. Concierge orders it."
            },
            {
              "text": "Email to Transactions: “Prep. Listing in Bright”."
            },
            {
              "text": "A listing folder for the property is created in Google Drive. Email to Transactions: “New Listing Folder Created in Google Drive”."
            },
            {
              "text": "A RAW photo folder for the property is created in Google Drive. Email to Concierge (copying Operations) to schedule listing photos."
            },
            {
              "text": "The Command Center opens Concierge's Listing Agreement Signed checklist. Concierge is emailed that the deal moved."
            },
            {
              "text": "A note is added to your Follow Up Boss lead record that Concierge has been notified to coordinate photos."
            },
            {
              "text": "Follow Up Boss starts your “Seller Prepping Listing to Listing Launch” action plan."
            },
            {
              "text": "When you approve both descriptions in FORWARD OS, Concierge is notified in the Command Center and emailed the approved text."
            }
          ],
          "you": [
            {
              "text": "Expect Concierge to contact you to schedule and coordinate listing photos."
            },
            {
              "text": "In Follow Up Boss, open the seller deal card and fill in the list price, commission and projected list date. Concierge checks these on the Follow Up Boss deal card."
            },
            {
              "text": "Make sure the listing description is written in FORWARD OS. Read and approve both the full listing description and the shorter flyer description. Check both boxes once approved. You do not enter the description in the MLS."
            },
            {
              "text": "Going Coming Soon? Once all information is loaded and accurate in Bright, slide the Follow Up Boss deal card to Coming Soon and tell Transactions to mark it Coming Soon in the MLS."
            },
            {
              "text": "Set open house dates for your first weekend live with Transactions."
            },
            {
              "text": "Every Tuesday morning Concierge emails the team “Open Houses This Week (Reply All Requested)”. Reply all by 5 PM Wednesday with the address, date and time of every open house you are hosting that weekend, so Concierge can post it on social media and Transactions can send the Active Pipe emails."
            },
            {
              "text": "Do not mark the property live until Concierge has sent the seller the “Listing Launch Week” email."
            },
            {
              "text": "When the home is ready for showings: update the status in Bright to Active, slide the Follow Up Boss deal card to Listed, and change the Follow Up Boss lead stage to Active Listing."
            }
          ],
          "concierge": [
            {
              "text": "Reviews your seller deal card in Follow Up Boss: list price, commission, projected list date."
            },
            {
              "text": "Sends the seller the “Welcome to the FORWARD Listing Experience” email."
            },
            {
              "text": "List price over $1.5M: sends the Home Staging Consultation email and coordinates the consultation."
            },
            {
              "text": "Confirms photo and video dates and times with you and the seller, then sends the seller the “Your Media Day” email."
            },
            {
              "text": "Is notified in the Command Center when you have approved both descriptions, then sends the listing description to the MLS and the flyer description to marketing for the listing flyer."
            },
            {
              "text": "Orders marketing materials."
            },
            {
              "text": "Orders the sign install."
            },
            {
              "text": "If you are going Coming Soon: the Coming Soon social post."
            },
            {
              "text": "Once photos are delivered and in the MLS: sends the seller the “Preparing to Launch” email."
            }
          ],
          "transactions": [
            {
              "text": "Preps the listing in Bright."
            },
            {
              "text": "Sets up the listing file in Google Drive and SkySlope."
            },
            {
              "text": "Works the listing file in Open To Close from here to closing."
            }
          ],
          "page": 4
        },
        {
          "num": 6,
          "title": "Photos delivered",
          "trigger": "The photographer's delivery folder is added in Google Drive",
          "automatic": [
            {
              "text": "Email to Transactions: “Listing Photos are Ready for MLS”."
            },
            {
              "text": "Email to Concierge and Transactions: “Listing Photos are Ready for Marketing”."
            }
          ],
          "you": [
            {
              "text": "Nothing for you at this step.",
              "none": true
            }
          ],
          "concierge": [
            {
              "text": "Uses the photos for your listing's marketing and social posts."
            }
          ],
          "transactions": [
            {
              "text": "Uploads the photos to the MLS."
            }
          ],
          "page": 5
        },
        {
          "num": 7,
          "title": "Coming Soon",
          "trigger": "You slide the Follow Up Boss deal card to Coming Soon",
          "automatic": [
            {
              "text": "Email to Transactions: “Please send Coming Soon Active Pipe”."
            },
            {
              "text": "Email to Concierge and Operations: “New Coming Soon Post Needed”."
            },
            {
              "text": "The Command Center opens Concierge's Coming Soon checklist. Concierge is emailed that the deal moved."
            }
          ],
          "you": [
            {
              "text": "Make sure Transactions knows to mark the listing Coming Soon in the MLS."
            }
          ],
          "concierge": [
            {
              "text": "Shares the Coming Soon marketing with you and the seller."
            },
            {
              "text": "Posts the Coming Soon announcement on social media."
            }
          ],
          "transactions": [
            {
              "text": "Marks the listing Coming Soon in the MLS."
            },
            {
              "text": "Sends the Coming Soon Active Pipe."
            }
          ],
          "page": 5
        },
        {
          "num": 8,
          "title": "Listed",
          "trigger": "You slide the Follow Up Boss deal card to Listed",
          "automatic": [
            {
              "text": "Email to Transactions: “Please send Just Listed Active Pipe”."
            },
            {
              "text": "Email to Concierge and Operations: “New Just Listed Post Needed”."
            },
            {
              "text": "Email to Concierge: send the seller the “We’re Officially on the Market” email."
            },
            {
              "text": "The Command Center opens Concierge's Listed checklist. Concierge is emailed that the deal moved."
            },
            {
              "text": "Follow Up Boss starts your “Seller Listing Active on MLS” action plan."
            }
          ],
          "you": [
            {
              "text": "Make sure the showing instructions in ShowingTime are set up and clear."
            },
            {
              "text": "Every Monday: send the Weekly Status Report to your seller. Concierge checks that it went out."
            },
            {
              "text": "Once under contract: update the price, commission and close date on the Follow Up Boss deal card, slide it to Pending, and change the Follow Up Boss lead stage to Listing Pending."
            },
            {
              "text": "Send the ratified contract to Transactions: FORWARD OS, Agent Tools, Contract to Close (Listing Agent)."
            }
          ],
          "concierge": [
            {
              "text": "Confirms the listing is live on the MLS, Zillow and Realtor.com."
            },
            {
              "text": "Sends the seller the “We’re Officially on the Market” email."
            },
            {
              "text": "Posts the active listing on social media."
            },
            {
              "text": "Every Monday: checks that you sent the Weekly Status Report."
            },
            {
              "text": "Vacant home: adds in-person property checks every two weeks to your calendar."
            }
          ],
          "transactions": [
            {
              "text": "Sends the Just Listed Active Pipe."
            }
          ],
          "page": 5
        },
        {
          "num": 9,
          "title": "Back on the Market",
          "trigger": "You slide the Follow Up Boss deal card to Back on the Market",
          "automatic": [
            {
              "text": "The Command Center opens Concierge's Back on the Market checklist. Concierge is emailed that the deal moved."
            }
          ],
          "you": [
            {
              "text": "Every Monday: send the Weekly Status Report to your seller."
            }
          ],
          "concierge": [
            {
              "text": "Confirms the MLS status is back to Active."
            },
            {
              "text": "Posts the Back on Market announcement on social media."
            },
            {
              "text": "Every Monday: checks that you sent the Weekly Status Report."
            },
            {
              "text": "Vacant home: adds in-person property checks every two weeks to your calendar."
            }
          ],
          "transactions": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "page": 6
        },
        {
          "num": 10,
          "title": "Pending",
          "trigger": "You slide the Follow Up Boss deal card to Pending",
          "automatic": [
            {
              "text": "Email to Concierge and Operations: “New Listing Under Contract Post Needed”."
            },
            {
              "text": "The Command Center opens Concierge's Pending checklist. Concierge is emailed that the deal moved."
            },
            {
              "text": "Follow Up Boss starts your “Seller Listing Pending” action plan."
            },
            {
              "text": "Follow Up Boss gives Transactions a task: update Bright and mark the listing Active Under Contract."
            }
          ],
          "you": [
            {
              "text": "Communicate with your sellers at least twice a week."
            },
            {
              "text": "Watch your email for inspection and appraisal communication. Negotiate and notify as needed."
            },
            {
              "text": "Check the preliminary ALTA for accuracy. No ALTA once you have the clear to close? Ask Transactions to email title and request one."
            },
            {
              "text": "Make sure every expense paid by you or the team is reimbursed, directly or on the ALTA."
            },
            {
              "text": "Concierge will tell you when the team closing gift is ready for you at the Mass Ave office."
            },
            {
              "text": "Once officially closed: slide the Follow Up Boss deal card to Closed This Quarter. This starts the post-closing program."
            }
          ],
          "concierge": [
            {
              "text": "Checks in with Transactions after all contingencies clear, and gets the clear to close when it comes in."
            },
            {
              "text": "Has the team closing gift ready at the Mass Ave office and emails you to pick it up and write a personal note to your client."
            },
            {
              "text": "Confirms the closing date and settlement details with Transactions."
            },
            {
              "text": "After closing, checks that the post-closing program started in the Command Center."
            }
          ],
          "transactions": [
            {
              "text": "Updates Bright and marks the listing Active Under Contract."
            },
            {
              "text": "Runs the contract to close in Open To Close."
            },
            {
              "text": "Requests the ALTA from title as part of the file."
            },
            {
              "text": "If the ALTA has not been received by the time clear to close is given, requests it from title again when you ask."
            }
          ],
          "page": 6
        },
        {
          "num": 11,
          "title": "Closed This Quarter",
          "trigger": "You slide the Follow Up Boss deal card to Closed This Quarter",
          "automatic": [
            {
              "text": "Email to Concierge: “Sign Removal”. Concierge orders the sign removed."
            },
            {
              "text": "Email to Concierge and Transactions: “Google Review” request for this client."
            },
            {
              "text": "Email to Concierge and Operations: “Just Sold Post Needed”."
            },
            {
              "text": "The Command Center starts the 365 day post-closing program. Every touchpoint gets a due date counted from the closing date. Concierge is emailed that the deal moved."
            },
            {
              "text": "A note is added to your Follow Up Boss lead record: Concierge will reach out when it is time for you to follow up with your client."
            }
          ],
          "you": [
            {
              "text": "Pick up your lockbox."
            },
            {
              "text": "Over the next year, Concierge will reach out to you each time it is your turn to follow up with your client."
            }
          ],
          "concierge": [
            {
              "text": "Runs the 365 day post-closing program and tells you when a touchpoint is yours."
            },
            {
              "text": "Day 8: sends the “Welcome to the Next Chapter” email."
            },
            {
              "text": "Day 180: curated seasonal gift delivery."
            },
            {
              "text": "Day 268: warm-up email to your client ahead of your referral conversation."
            },
            {
              "text": "Day 300: sends the coffee or lunch invite if you have not connected with your client."
            },
            {
              "text": "Day 360: one-year sale anniversary gift and note. Operations procures it, Concierge delivers it, you sign the note."
            },
            {
              "text": "Orders the sign removed."
            },
            {
              "text": "Asks your client for a Google review, and the Just Sold post with Operations."
            }
          ],
          "transactions": [
            {
              "text": "Closes out the file."
            }
          ],
          "page": 7
        }
      ]
    },
    {
      "title": "Buyers",
      "intro": "Each stage shows what happens on its own the moment you move the card, then what is yours, what Concierge does and what Transactions does.",
      "stages": [
        {
          "num": 1,
          "title": "Appointment Set",
          "trigger": "You change the Follow Up Boss lead stage to Appointment Set (lead type Buyer or Buyer/Seller)",
          "automatic": [
            {
              "text": "Follow Up Boss starts your “Buyer Appointment Set: New Buyer Lead” action plan."
            }
          ],
          "you": [
            {
              "text": "Create a Follow Up Boss deal card in the Buyers pipeline at Buyer Engaged. This automatically creates the buyer card in FORWARD OS."
            },
            {
              "text": "Schedule the 15 minute pre-qualification call and add it to your client's calendar."
            },
            {
              "text": "On the call, gauge how serious the buyer is: do they rent or own, what is their timeline, have they spoken to a lender, have they been to open houses?"
            },
            {
              "text": "After the call: update the Follow Up Boss deal card with estimated price, estimated close date and estimated commission, and select the Market and Source custom fields."
            },
            {
              "text": "In FORWARD OS, open the Buyer Needs Analysis and record a post-meeting recap. FORWARD OS fills in budget, timeline, neighborhoods, pre-approval status and more from it."
            },
            {
              "text": "Slide the Follow Up Boss deal card to 15 Min Pre-Qual Complete."
            }
          ],
          "concierge": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "transactions": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "page": 8
        },
        {
          "num": 2,
          "title": "Buyer Engaged",
          "trigger": "You create the Follow Up Boss deal card in the Buyers pipeline",
          "automatic": [
            {
              "text": "A buyer card is created in FORWARD OS under your name."
            }
          ],
          "you": [
            {
              "text": "Nothing for you at this step.",
              "none": true
            }
          ],
          "concierge": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "transactions": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "page": 8
        },
        {
          "num": 3,
          "title": "15 Min Pre-Qual Complete",
          "trigger": "You slide the Follow Up Boss deal card to 15 Min Pre-Qual Complete",
          "automatic": [
            {
              "text": "Follow Up Boss starts your “Buyer 15 Min Pre-Qual Complete” action plan."
            }
          ],
          "you": [
            {
              "text": "Lender: working with our Financial Team? Select the lender under Details. An independent lender? Type the name in the custom field *Lender Name. Undecided? Skip this for now."
            },
            {
              "text": "If it was not scheduled on the call: schedule the buyer consultation."
            },
            {
              "text": "Send a calendar invite for the consultation to everyone attending."
            },
            {
              "text": "Send the “Buyer Consultation Confirmation” email. Do not skip this: it carries the Buyer Needs Questionnaire that trains FORWARD OS on this buyer."
            },
            {
              "text": "Check the Buyer Needs Questionnaire came back. If not, remind your client why it matters."
            },
            {
              "text": "In FORWARD OS, open the Buyer Consultation Kit, check the information and generate the PDF. Bring it or send it to your client."
            },
            {
              "text": "After the consultation: slide the Follow Up Boss deal card to Buyer Consult Complete."
            },
            {
              "text": "Ready to sign a Buyer Agreement? Add the tag FWRD Buyer Onboarding, then set the Follow Up Boss lead stage to Buyer A (0 to 60 day timeline) or Buyer B (60 to 120 days)."
            },
            {
              "text": "Not ready to sign? Set the Follow Up Boss lead stage to Buyer C or Nurture."
            }
          ],
          "concierge": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "transactions": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "page": 9
        },
        {
          "num": 4,
          "title": "Tag: FWRD Buyer Onboarding",
          "trigger": "You add the tag FWRD Buyer Onboarding to the Follow Up Boss lead record",
          "automatic": [
            {
              "text": "Follow Up Boss starts your “Buyer Onboarding” action plan."
            }
          ],
          "you": [
            {
              "text": "Request the Buyer Agreement and buyer disclosures: FORWARD OS, Agent Tools, Buyer Representation Agreement Request."
            },
            {
              "text": "Not signed within 24 hours? Follow up with your buyer."
            },
            {
              "text": "Send the “Buyer Onboarding” email. Do not skip this."
            },
            {
              "text": "Check the lender: our Financial Team selected under Details, or the buyer's lender typed in *Lender Name."
            },
            {
              "text": "Check the Follow Up Boss lead stage: Buyer A, B, C or Nurture."
            },
            {
              "text": "Once the Buyer Agreement is signed: slide the Follow Up Boss deal card to BA Signed, then to Actively Showing."
            }
          ],
          "concierge": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "transactions": [
            {
              "text": "Prepares the Buyer Agreement and buyer disclosures from your request in FORWARD OS and sends them to your buyer for signatures."
            }
          ],
          "page": 10
        },
        {
          "num": 5,
          "title": "BA Signed",
          "trigger": "You slide the Follow Up Boss deal card to BA Signed",
          "automatic": [
            {
              "text": "A buyer folder is created in Google Drive. Email to Transactions: “New Buyer Folder Created in Google Drive”."
            },
            {
              "text": "The Command Center opens the buyer file with Concierge's tasks and yours. Concierge is emailed that the deal moved."
            }
          ],
          "you": [
            {
              "text": "Check the lender is selected, or named in the custom field *Lender Name."
            },
            {
              "text": "Check the Follow Up Boss lead stage is Buyer A, B, C or Nurture."
            },
            {
              "text": "Slide the Follow Up Boss deal card to Actively Showing when you start showing homes."
            }
          ],
          "concierge": [
            {
              "text": "Reviews your deal card in Follow Up Boss and FORWARD OS: price, close date, commission, lender and lead stage."
            },
            {
              "text": "Checks that the Buyer Needs Assessment is on file in FORWARD OS."
            },
            {
              "text": "Sends your buyer the “Welcome to the FORWARD Client Experience” email (buyer version)."
            }
          ],
          "transactions": [
            {
              "text": "Files the signed Buyer Agreement in the buyer's Google Drive folder."
            }
          ],
          "page": 10
        },
        {
          "num": 6,
          "title": "Actively Showing",
          "trigger": "You slide the Follow Up Boss deal card to Actively Showing",
          "automatic": [
            {
              "text": "Follow Up Boss starts your “Buyer Actively Showing Property” action plan."
            },
            {
              "text": "The Command Center updates the buyer file. Concierge is emailed that the deal moved."
            }
          ],
          "you": [
            {
              "text": "Offer accepted: rename the Follow Up Boss deal card to the property address, update price, closing date and commission to match the contract, then slide it to Pending."
            },
            {
              "text": "Send the ratified offer to Transactions: FORWARD OS, Agent Tools, Contract to Close (Buyer's Agent)."
            }
          ],
          "concierge": [
            {
              "text": "Checks in with you once a week to see if there is any client communication they can help with."
            }
          ],
          "transactions": [
            {
              "text": "Nothing for this team at this step.",
              "none": true
            }
          ],
          "page": 11
        },
        {
          "num": 7,
          "title": "Pending",
          "trigger": "You slide the Follow Up Boss deal card to Pending",
          "automatic": [
            {
              "text": "Email to Concierge and Operations: “New Buyer Under Contract Post Needed”."
            },
            {
              "text": "Follow Up Boss starts your “Buyer Pending” action plan."
            },
            {
              "text": "The Command Center updates the buyer file. Concierge is emailed that the deal moved."
            }
          ],
          "you": [
            {
              "text": "Change the Follow Up Boss lead stage to Pending."
            },
            {
              "text": "Schedule the home inspection and copy transactions@fwrdrealestate.com once it is confirmed. FORWARD OS can recommend inspectors."
            },
            {
              "text": "Add the inspection to your client's calendar, and attend it."
            },
            {
              "text": "Next day: review the inspection findings with your buyer."
            },
            {
              "text": "Negotiating? Draft the repair or credit addendum and send it with the inspection report to the listing agent within the contract deadline."
            },
            {
              "text": "Void only? Tell Transactions whether the deal is moving forward. If it is not, slide the card back to Actively Showing and update the Follow Up Boss lead stage."
            },
            {
              "text": "Check whether the appraisal met or exceeded value. Appraisal gap? Coordinate the addendum with Transactions."
            },
            {
              "text": "Set the final walkthrough and settlement with Transactions, then attend both."
            },
            {
              "text": "Once closed: confirm price, settlement date and commission on the Follow Up Boss deal card, then slide it to Closed This Quarter. This starts post-closing."
            }
          ],
          "concierge": [
            {
              "text": "Checks in with you once a week."
            },
            {
              "text": "Has the team closing gift ready at the Mass Ave office and tells you when to pick it up."
            },
            {
              "text": "Reminds you to consider adding a personal gift."
            }
          ],
          "transactions": [
            {
              "text": "Runs the contract to close in Open To Close."
            },
            {
              "text": "Gets signatures on the inspection and appraisal addendums and informs all parties."
            },
            {
              "text": "Schedules the final walkthrough and settlement with you."
            }
          ],
          "page": 11
        },
        {
          "num": 8,
          "title": "Closed This Quarter",
          "trigger": "You slide the Follow Up Boss deal card to Closed This Quarter",
          "automatic": [
            {
              "text": "Email to Concierge and Transactions: “Google Review” request for this client."
            },
            {
              "text": "Email to Concierge and Operations: “New Buyer Closed Post Needed”."
            },
            {
              "text": "The Command Center starts the 365 day buyer post-closing program, with due dates counted from closing. Concierge is emailed that the deal moved."
            },
            {
              "text": "Follow Up Boss starts your “Buyer Closed: 365 Follow-Up” action plan and adds a congratulations note."
            }
          ],
          "you": [
            {
              "text": "Make sure Transactions has the fully executed ALTA and every document is in SkySlope, including the Commission Disbursement Form."
            },
            {
              "text": "Change the Follow Up Boss lead stage to Closed. Update the Closing Gift Given custom field, your buyers' birthdays, and their mailing address (unless it is an investment property)."
            },
            {
              "text": "Follow your buyers on social media."
            },
            {
              "text": "Over the next year, Concierge will reach out to you each time it is your turn to follow up with your client."
            }
          ],
          "concierge": [
            {
              "text": "Runs the 365 day post-closing program and tells you when a touchpoint is yours."
            },
            {
              "text": "Day 8: sends the “Welcome Home” email."
            },
            {
              "text": "Day 30: housewarming reminder and champagne."
            },
            {
              "text": "Seasonal service reminder emails on fixed dates, the next four after closing: Spring March 1, Summer May 15, Fall September 1, Winter November 1."
            },
            {
              "text": "Day 180: Mid-Year Home Refresh care package."
            },
            {
              "text": "Day 345: market and equity update email."
            },
            {
              "text": "Day 360: new home anniversary gift and note, with Operations."
            },
            {
              "text": "Asks your client for a Google review, and the Buyer Closed post with Operations."
            }
          ],
          "transactions": [
            {
              "text": "Collects the fully executed ALTA and closes out the file in SkySlope."
            }
          ],
          "page": 12
        }
      ]
    }
  ],
  "also": {
    "title": "Also automatic",
    "rows": [
      {
        "when": "Every week",
        "who": "Concierge, copy Transactions",
        "what": "Reminder to collect ShowingTime feedback for your sellers."
      },
      {
        "when": "Every Tuesday, 8:15 AM",
        "who": "From Concierge to agents, copying Operations and Transactions",
        "what": "Open Houses This Week (Reply All Requested). Reply all by 5 PM Wednesday with the address, date and time of every open house you are hosting that weekend."
      },
      {
        "when": "Intake forms",
        "who": "Concierge and Operations",
        "what": "Emailed when a Buyer or Seller Intake Form comes in."
      },
      {
        "when": "Listing description approved",
        "who": "Concierge",
        "what": "Emailed the approved text from FORWARD OS when you press Approve for marketing."
      }
    ],
    "footnote": {
      "before": "Built from FORWARD's live Zapier Zaps, Follow Up Boss automations and action plans, and the Command Center, as of ",
      "date": "October 17, 2026",
      "dateStrayFont": true,
      "after": ". When an automation changes, this sheet is updated."
    }
  }
};
