
'use server';

import {
  db,
  firestoreServerTimestamp,
  Timestamp,
  type FieldValue,
  deleteDoc, // Added deleteDoc
} from '@/lib/firebase';
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  type FirestoreError, // Ensure FirestoreError is imported
} from 'firebase/firestore';
import type { GameAssessment, GameAssessmentOutput, UserGameScore } from '@/types/gameAssessment';

const COURSES_COLLECTION = 'courses';
const MODULES_SUBCOLLECTION = 'modules';
const GAME_ASSESSMENTS_SUBCOLLECTION = 'gameAssessments';
const USERS_COLLECTION = 'users'; // Assuming student profiles are under 'users' or 'students'
const GAME_SCORES_SUBCOLLECTION = 'gameScores';

/**
 * Saves a newly generated game assessment to Firestore.
 * @param courseId The ID of the course.
 * @param moduleId The ID of the module.
 * @param assessmentOutput The assessment data generated by the AI flow.
 * @returns The ID of the newly created game assessment document.
 */
export async function saveGeneratedAssessment(
  courseId: string,
  moduleId: string,
  assessmentOutput: GameAssessmentOutput // This is Omit<GameAssessment, 'id' | 'courseId' | 'moduleId' | 'generatedAt' | 'approvedByAdmin'>
): Promise<string> {
  if (!courseId || !moduleId) {
    throw new Error('Course ID and Module ID are required.');
  }

  const assessmentData: Omit<GameAssessment, 'id' | 'generatedAt'> & { generatedAt: FieldValue } = {
    courseId,
    moduleId,
    ...assessmentOutput,
    generatedAt: firestoreServerTimestamp(),
    approvedByAdmin: false, // Default to not approved
  };

  const assessmentsCollectionRef = collection(
    db,
    COURSES_COLLECTION,
    courseId,
    MODULES_SUBCOLLECTION,
    moduleId,
    GAME_ASSESSMENTS_SUBCOLLECTION
  );

  try {
    const docRef = await addDoc(assessmentsCollectionRef, assessmentData);
    console.log('Generated game assessment saved with ID:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('Error saving generated assessment to Firestore:', error);
    throw new Error('Failed to save game assessment.');
  }
}

/**
 * Retrieves a specific game assessment from Firestore.
 * @param courseId The ID of the course.
 * @param moduleId The ID of the module.
 * @param assessmentId The ID of the game assessment.
 * @returns A promise resolving to the GameAssessment object or null if not found.
 */
export async function getGameAssessment(
  courseId: string,
  moduleId: string,
  assessmentId: string
): Promise<GameAssessment | null> {
  if (!courseId || !moduleId || !assessmentId) {
    // This should ideally be caught by the calling page's useEffect earlier
    throw new Error('Critical: Course ID, Module ID, or Assessment ID is missing in getGameAssessment call.');
  }

  const path = `${COURSES_COLLECTION}/${courseId}/${MODULES_SUBCOLLECTION}/${moduleId}/${GAME_ASSESSMENTS_SUBCOLLECTION}/${assessmentId}`;
  const assessmentDocRef = doc(db, path);

  try {
    const docSnap = await getDoc(assessmentDocRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      let generatedAtProcessed: string;

      // Robust handling of generatedAt
      if (data.generatedAt instanceof Timestamp) {
        generatedAtProcessed = data.generatedAt.toDate().toISOString();
      } else if (typeof data.generatedAt === 'string') {
        // Attempt to parse if it's a string that might be a date
        const parsedDate = new Date(data.generatedAt);
        if (!isNaN(parsedDate.getTime())) {
          generatedAtProcessed = parsedDate.toISOString();
        } else {
          console.warn(`Assessment ${assessmentId} has an unparseable generatedAt string:`, data.generatedAt);
          generatedAtProcessed = new Date(0).toISOString(); // Fallback
        }
      } else if (data.generatedAt && typeof (data.generatedAt as any).toDate === 'function') {
        // Handle Firestore-like objects with a toDate method
        generatedAtProcessed = (data.generatedAt as any).toDate().toISOString();
      } else {
        console.warn(`Assessment ${assessmentId} has an unexpected or missing generatedAt type:`, data.generatedAt);
        generatedAtProcessed = new Date(0).toISOString(); // Fallback to epoch for missing/unrecognized
      }

      return {
        id: docSnap.id,
        ...data,
        generatedAt: generatedAtProcessed, // Ensure this is a string
      } as GameAssessment;
    }
    console.log(`Game assessment not found at path: ${path}`);
    return null;
  } catch (error: any) {
    console.error(`Error fetching game assessment from path ${path}:`, error);
    // Provide a more specific error message to the client
    throw new Error(`Failed to fetch game assessment. Details: ${error.message || String(error)}`);
  }
}


/**
 * Retrieves all game assessments for a given module.
 * Can optionally filter by admin approval status for student view.
 * @param courseId The ID of the course.
 * @param moduleId The ID of the module.
 * @param forAdminView If true, fetches all assessments, otherwise only approved ones.
 * @returns A promise resolving to an array of GameAssessment objects.
 */
export async function getGameAssessmentsForModule(
  courseId: string,
  moduleId: string,
  forAdminView: boolean = false
): Promise<GameAssessment[]> {
  if (!courseId || !moduleId) {
    throw new Error('Course ID and Module ID are required.');
  }
  const assessmentsCollectionRef = collection(
    db,
    COURSES_COLLECTION,
    courseId,
    MODULES_SUBCOLLECTION,
    moduleId,
    GAME_ASSESSMENTS_SUBCOLLECTION
  );

  let q;
  if (forAdminView) {
    q = query(assessmentsCollectionRef, orderBy('generatedAt', 'desc'));
  } else {
    // Student view: only approved assessments
    q = query(assessmentsCollectionRef, where('approvedByAdmin', '==', true), orderBy('generatedAt', 'desc'));
  }


  try {
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(docSnap => {
      const data = docSnap.data();
      let generatedAtProcessed: string;

      // Robust handling of generatedAt
      if (data.generatedAt instanceof Timestamp) {
        generatedAtProcessed = data.generatedAt.toDate().toISOString();
      } else if (typeof data.generatedAt === 'string') {
         const parsedDate = new Date(data.generatedAt);
        if (!isNaN(parsedDate.getTime())) {
          generatedAtProcessed = parsedDate.toISOString();
        } else {
          console.warn(`Assessment ${docSnap.id} (in list) has an unparseable generatedAt string:`, data.generatedAt);
          generatedAtProcessed = new Date(0).toISOString(); // Fallback
        }
      } else if (data.generatedAt && typeof (data.generatedAt as any).toDate === 'function') {
        generatedAtProcessed = (data.generatedAt as any).toDate().toISOString();
      } else {
        console.warn(`Assessment ${docSnap.id} (in list) has an unexpected or missing generatedAt type:`, data.generatedAt);
        generatedAtProcessed = new Date(0).toISOString(); // Fallback
      }
      return {
        id: docSnap.id,
        ...data,
        generatedAt: generatedAtProcessed, // Ensure this is a string
      } as GameAssessment;
    });
  } catch (error) {
    const firebaseError = error as FirestoreError;
    console.error('Error fetching game assessments for module:', firebaseError.message, 'Code:', firebaseError.code, 'Details:', firebaseError);
    let userMessage = 'Failed to fetch game assessments for module.';
    if (firebaseError.code === 'failed-precondition' && firebaseError.message.includes('requires an index')) {
      userMessage += ' This often means a Firestore index is missing. Please check your Firebase console for an error message with a link to create the required index. The query involves filtering by `approvedByAdmin` and ordering by `generatedAt`.';
    } else if (firebaseError.code === 'permission-denied') {
      userMessage += ' Firestore security rules denied access to fetch these assessments.';
    } else if (firebaseError.message) {
      userMessage += ` Details: ${firebaseError.message}`;
    }
    throw new Error(userMessage);
  }
}

/**
 * Saves a user's game score and attempt history.
 * The document ID in gameScores will be the assessmentId.
 * @param userId Firebase Auth UID of the student.
 * @param scoreData Data for the user's game score.
 * @returns Promise<void>
 */
export async function saveUserGameScore(
  userId: string,
  scoreData: Omit<UserGameScore, 'id' | 'userId' | 'completedAt'> & { completedAt?: FieldValue }
): Promise<void> {
  if (!userId || !scoreData.assessmentId || !scoreData.courseId || !scoreData.moduleId) {
    throw new Error('User ID, assessment ID, course ID, and module ID are required.');
  }

  const scoreDocRef = doc(
    db,
    USERS_COLLECTION,
    userId,
    GAME_SCORES_SUBCOLLECTION,
    scoreData.assessmentId // Use assessmentId as the document ID for the score
  );

  const dataToSave: UserGameScore = {
    ...scoreData,
    userId,
    completedAt: scoreData.completedAt || firestoreServerTimestamp(),
  };

  try {
    await setDoc(scoreDocRef, dataToSave, { merge: true });
    console.log(`Game score for assessment ${scoreData.assessmentId} saved for user ${userId}.`);
  } catch (error) {
    console.error('Error saving user game score:', error);
    throw new Error('Failed to save user game score.');
  }
}

/**
 * Retrieves a user's game score for a specific assessment.
 * @param userId Firebase Auth UID.
 * @param assessmentId The ID of the assessment.
 * @returns Promise resolving to UserGameScore or null.
 */
export async function getUserGameScore(userId: string, assessmentId: string): Promise<UserGameScore | null> {
    if (!userId || !assessmentId) {
        throw new Error('User ID and Assessment ID are required.');
    }
    const scoreDocRef = doc(db, USERS_COLLECTION, userId, GAME_SCORES_SUBCOLLECTION, assessmentId);
    try {
        const docSnap = await getDoc(scoreDocRef);
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() } as UserGameScore;
        }
        return null;
    } catch (error) {
        console.error('Error fetching user game score:', error);
        throw new Error('Failed to fetch user game score.');
    }
}

/**
 * Approves or unapproves a game assessment by an admin.
 * @param courseId The ID of the course.
 * @param moduleId The ID of the module.
 * @param assessmentId The ID of the game assessment.
 * @param approveStatus Boolean indicating whether to approve (true) or unapprove (false).
 */
export async function setGameAssessmentApproval(
  courseId: string,
  moduleId: string,
  assessmentId: string,
  approveStatus: boolean
): Promise<void> {
  if (!courseId || !moduleId || !assessmentId) {
    throw new Error('Course ID, Module ID, and Assessment ID are required.');
  }
  const assessmentDocRef = doc(
    db,
    COURSES_COLLECTION,
    courseId,
    MODULES_SUBCOLLECTION,
    moduleId,
    GAME_ASSESSMENTS_SUBCOLLECTION,
    assessmentId
  );
  try {
    await setDoc(assessmentDocRef, { approvedByAdmin: approveStatus }, { merge: true });
    console.log(`Assessment ${assessmentId} approval status set to ${approveStatus}.`);
  } catch (error) {
    console.error('Error updating game assessment approval status:', error);
    throw new Error('Failed to update game assessment approval status.');
  }
}

/**
 * Deletes a game assessment.
 * @param courseId The ID of the course.
 * @param moduleId The ID of the module.
 * @param assessmentId The ID of the game assessment.
 */
export async function deleteGameAssessment(
  courseId: string,
  moduleId: string,
  assessmentId: string
): Promise<void> {
  if (!courseId || !moduleId || !assessmentId) {
    throw new Error('Course ID, Module ID, and Assessment ID are required.');
  }
  const assessmentDocRef = doc(
    db,
    COURSES_COLLECTION,
    courseId,
    MODULES_SUBCOLLECTION,
    moduleId,
    GAME_ASSESSMENTS_SUBCOLLECTION,
    assessmentId
  );
  try {
    await deleteDoc(assessmentDocRef);
    console.log(`Assessment ${assessmentId} deleted successfully.`);
  } catch (error) {
    console.error('Error deleting game assessment:', error);
    throw new Error('Failed to delete game assessment.');
  }
}
