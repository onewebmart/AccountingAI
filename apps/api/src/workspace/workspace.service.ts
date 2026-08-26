import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DocumentStatus, ProposedEntryStatus, UserRole } from '@ai-accounting/shared';
import { Organization, OrganizationDocument } from '../tenancy/schemas/organization.schema';
import { Firm, FirmDocument } from '../tenancy/schemas/firm.schema';
import { User, UserDocument } from '../tenancy/schemas/user.schema';
import { Document, DocumentDocument } from '../documents/schemas/document.schema';
import {
  ProposedEntry,
  ProposedEntryDocument,
} from '../proposals/schemas/proposed-entry.schema';
import { UsageMeter, UsageMeterDocument } from '../ocr/schemas/usage-meter.schema';

/**
 * Cost model for the AI meter, mirroring platform-admin's.
 *
 * Kept as its own copy deliberately: the platform figure is a billing input and
 * this one is an at-a-glance indicator for the org. Coupling them would mean a
 * pricing change silently redrawing someone's usage bar mid-month.
 */
const COST_PAISE = {
  tier1PerPage: 1,
  tier2PerPage: 10,
  tier3PerPage: 150,
  aiInPer1K: 2,
  aiOutPer1K: 8,
};

/** Documents still waiting on the pipeline or on a person. */
const INBOX_STATUSES = [
  DocumentStatus.UPLOADED,
  DocumentStatus.CLASSIFYING,
  DocumentStatus.EXTRACTING,
  DocumentStatus.EXTRACTED,
  DocumentStatus.DUPLICATE,
  DocumentStatus.FAILED,
];

export interface Workspace {
  user: {
    id: string;
    name: string;
    email: string;
    initials: string;
    role: string;
    /** Set only for someone who runs the practice. */
    firmRole?: string;
  };
  org: { id: string; name: string; gstin?: string };
  /**
   * Present only when this user may actually reach the practice.
   *
   * Belonging to an org that has a firm is not enough — every /firm and /crm
   * route additionally requires firm admin. Returning the firm to a plain
   * accountant would put a Practice section in their sidebar where every link
   * answers 403.
   */
  firm?: { id: string; name: string };
  counts: {
    /** Documents needing attention — the Inbox badge. */
    inbox: number;
    /** Proposals awaiting a human decision — the Review badge. */
    review: number;
  };
  aiUsage: {
    /** Integer paise (Invariant 1). */
    spentPaise: number;
    period: string;
  };
}

/** "Rajesh Sharma" → "RS". Falls back to the email when no name is set. */
function initialsOf(name: string | undefined, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

@Injectable()
export class WorkspaceService {
  constructor(
    @InjectModel(Organization.name) private orgModel: Model<OrganizationDocument>,
    @InjectModel(Firm.name) private firmModel: Model<FirmDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Document.name) private documentModel: Model<DocumentDocument>,
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
    @InjectModel(UsageMeter.name) private usageMeterModel: Model<UsageMeterDocument>,
  ) {}

  /**
   * Everything the app shell needs, in one call.
   *
   * One round trip rather than five, because the shell renders on every single
   * page — a chattier version would put four extra requests on every navigation.
   */
  async forUser(
    userId: string,
    orgId: string,
    role: string,
    firmRole?: string,
  ): Promise<Workspace> {
    const period = new Date().toISOString().slice(0, 7);

    const [user, org, documents, reviewCount, meter] = await Promise.all([
      this.userModel.findById(userId).exec(),
      this.orgModel.findById(orgId).exec(),
      // Counted here rather than in the DB because the tenant plugin scopes
      // find() but the caller may legitimately have no org context yet.
      this.documentModel.countDocuments({ orgId, status: { $in: INBOX_STATUSES } }).exec(),
      this.proposalModel
        .countDocuments({ orgId, status: ProposedEntryStatus.PROPOSED })
        .exec(),
      this.usageMeterModel.findOne({ orgId, period }).exec(),
    ]);

    const email = user?.email ?? '';
    const name = user?.name ?? email;

    // `role === FIRM_ADMIN` is the pre-split shape; still honoured while old
    // tokens and unmigrated memberships drain.
    const runsThePractice = firmRole === UserRole.FIRM_ADMIN || role === UserRole.FIRM_ADMIN;
    const firm =
      org?.firmId && runsThePractice ? await this.firmModel.findById(org.firmId).exec() : null;

    return {
      user: {
        id: userId,
        name,
        email,
        initials: initialsOf(user?.name, email),
        role,
        ...(firmRole ? { firmRole } : {}),
      },
      org: {
        id: orgId,
        // Falling back to the id would put an ObjectId in the header, which is
        // what this endpoint exists to stop.
        name: org?.name ?? 'Your workspace',
        gstin: org?.gstin,
      },
      firm: firm ? { id: firm._id.toString(), name: firm.name } : undefined,
      counts: { inbox: documents, review: reviewCount },
      aiUsage: { spentPaise: this.costOf(meter), period },
    };
  }

  private costOf(meter: UsageMeterDocument | null): number {
    if (!meter) return 0;

    return (
      meter.ocrPagesTier1 * COST_PAISE.tier1PerPage +
      meter.ocrPagesTier2 * COST_PAISE.tier2PerPage +
      meter.ocrPagesTier3 * COST_PAISE.tier3PerPage +
      Math.floor(meter.groqTokensIn / 1000) * COST_PAISE.aiInPer1K +
      Math.floor(meter.groqTokensOut / 1000) * COST_PAISE.aiOutPer1K
    );
  }
}
